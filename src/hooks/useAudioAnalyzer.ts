import { useRef, useState, useCallback } from 'react'

// ── 타입 ──────────────────────────────────────────────────────────────────────

export interface EQSuggestion {
  geqBand:       string    // 1차 GEQ 밴드 (예: "1kHz")
  adjacentBands: string[]  // 인접 밴드 ±1옥타브 (함께 조정 권고)
  cutDB:         number    // 권고 컷값 (dB, 음수)
  Q:             number    // Q 팩터
  urgency:       PeakInfo['urgency']
}

export interface PeakInfo {
  freq:             number                          // 주파수 Hz
  db:               number                          // 신호 강도 dBFS
  note:             string                          // 음정명 (예: 'A4')
  midi:             number                          // MIDI 번호
  cents:            number                          // 센트 오프셋
  wavelengthM:      number                          // 파장 (m)
  geqBand:          string                          // 1차 GEQ 밴드
  adjacentBands:    string[]                        // 인접 밴드
  cutDB:            number                          // 권고 컷값
  Q:                number                          // Q 팩터
  urgency:          'critical' | 'warning' | 'info' // 긴급도
  confirmed:        boolean                         // 지속성 확정 여부 (30프레임 이상)
  persistenceFrames: number                         // 연속 감지 프레임 수
}

// ── 상수 ──────────────────────────────────────────────────────────────────────

const NOTE_NAMES  = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'] as const
const FFT_SIZE    = 8192
const MERGE_BINS  = 5    // 인접 빈 병합 범위 (±5빈 = 같은 피크)
const MAX_PEAKS   = 5    // 최대 피크 수
const PERSIST_FRAMES = 30 // 지속성 확정 프레임 수 (≈0.5s @ 60fps)
const NOISE_HISTORY  = 128 // 동적 플로어 히스토리 크기
const NOISE_MARGIN   = 10  // 동적 플로어 = 배경평균 + 10dB

// ISO 31밴드 GEQ (20Hz ~ 20kHz)
const GEQ_BANDS = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500,
  630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300,
  8000, 10000, 12500, 16000, 20000,
] as const

// ── 순수 함수 ─────────────────────────────────────────────────────────────────

/** Hz → GEQ 밴드 레이블 */
function bandLabel(hz: number): string {
  return hz >= 1000 ? `${hz / 1000}kHz` : `${hz}Hz`
}

/** 주파수 → 가장 가까운 ISO GEQ 밴드 인덱스 */
function closestGEQIndex(freq: number): number {
  let best = 0
  let bestDist = Math.abs(GEQ_BANDS[0] - freq)
  for (let i = 1; i < GEQ_BANDS.length; i++) {
    const d = Math.abs(GEQ_BANDS[i] - freq)
    if (d < bestDist) { bestDist = d; best = i }
  }
  return best
}

/** 주파수 → EQ 제안 (인접 밴드 포함) */
function getEQSuggestion(freq: number): EQSuggestion {
  const idx     = closestGEQIndex(freq)
  const urgency: PeakInfo['urgency'] =
    freq < 2000 ? 'critical' : freq < 6000 ? 'warning' : 'info'

  // 인접 밴드: 1옥타브 위아래 인덱스 (대략 ±3 인덱스)
  const adjacentIdx = [idx - 3, idx + 3].filter(i => i >= 0 && i < GEQ_BANDS.length)
  const adjacentBands = adjacentIdx.map(i => bandLabel(GEQ_BANDS[i]))

  return {
    geqBand:      bandLabel(GEQ_BANDS[idx]),
    adjacentBands,
    cutDB:        urgency === 'critical' ? -6 : urgency === 'warning' ? -3 : -1.5,
    Q:            urgency === 'critical' ? 4.0 : 2.0,
    urgency,
  }
}

/** 주파수 → 음표 정보 */
function freqToNote(freq: number): { note: string; midi: number; cents: number } {
  const midiFloat = 69 + 12 * Math.log2(freq / 440)
  const midi      = Math.round(midiFloat)
  const cents     = Math.round((midiFloat - midi) * 100)
  const octave    = Math.floor(midi / 12) - 1
  const name      = NOTE_NAMES[((midi % 12) + 12) % 12]
  return { note: `${name}${octave}`, midi, cents }
}

/**
 * 다중 피크 감지 — 상위 MAX_PEAKS개, 인접 빈(MERGE_BINS) 병합
 * Parabolic interpolation으로 서브빈 정밀도 유지
 */
function detectMultiPeaks(
  data:       Float32Array,
  sampleRate: number,
  threshold:  number,
): Array<{ bin: number; db: number }> {
  const startBin = Math.ceil(20 / (sampleRate / FFT_SIZE))
  const peaks: Array<{ bin: number; db: number }> = []

  // 1) 로컬 최대값 검출
  for (let i = startBin + 1; i < data.length - 1; i++) {
    const val = data[i]
    if (val < threshold) continue
    if (val <= data[i - 1] || val <= data[i + 1]) continue

    // Parabolic interpolation
    const a = data[i - 1]
    const b = val
    const g = data[i + 1]
    const denom = a - 2 * b + g
    const offset = denom !== 0 ? 0.5 * (a - g) / denom : 0
    peaks.push({ bin: i + offset, db: val })
  }

  if (peaks.length === 0) return []

  // 2) dB 내림차순 정렬
  peaks.sort((x, y) => y.db - x.db)

  // 3) 인접 빈 병합 (±MERGE_BINS 범위)
  const merged: Array<{ bin: number; db: number }> = []
  for (const p of peaks) {
    const isMerged = merged.some(m => Math.abs(m.bin - p.bin) <= MERGE_BINS)
    if (!isMerged) merged.push(p)
    if (merged.length >= MAX_PEAKS) break
  }

  return merged
}

/**
 * 동적 노이즈 플로어 추적
 * NOISE_HISTORY 프레임의 평균 에너지 + NOISE_MARGIN dB
 */
function computeDynamicThreshold(history: Array<Float32Array<ArrayBuffer>>): number {
  if (history.length === 0) return -30

  // 각 프레임에서 중앙값(Median) 계산 → 평균
  let sum = 0
  for (const frame of history) {
    const sorted = Float32Array.from(frame).sort()
    sum += sorted[Math.floor(sorted.length * 0.5)] // 50th percentile
  }
  return sum / history.length + NOISE_MARGIN
}

// ── 지속성 추적 ───────────────────────────────────────────────────────────────

/** 빈 인덱스를 정수로 양자화하여 키로 사용 */
function binKey(bin: number): string {
  return String(Math.round(bin))
}

type PersistenceMap = Map<string, number>

/**
 * 지속성 맵 업데이트
 * - 현재 피크와 ±MERGE_BINS 내에 있으면 카운트 증가
 * - 없으면 새 키 생성 (count=1)
 * - 이번 프레임에 없는 기존 키는 제거 (지속성 끊김)
 */
function updatePersistence(
  current: Array<{ bin: number; db: number }>,
  prev:    PersistenceMap,
): PersistenceMap {
  const next: PersistenceMap = new Map()

  for (const p of current) {
    const key = binKey(p.bin)

    // 이전 맵에서 ±MERGE_BINS 범위 키 탐색
    let maxCount = 0
    for (const [k, count] of prev) {
      if (Math.abs(Number(k) - p.bin) <= MERGE_BINS) {
        maxCount = Math.max(maxCount, count)
      }
    }
    next.set(key, maxCount + 1)
  }

  return next
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAudioAnalyzer() {
  const audioCtxRef    = useRef<AudioContext | null>(null)
  const analyserRef    = useRef<AnalyserNode | null>(null)
  const streamRef      = useRef<MediaStream | null>(null)
  const rafRef         = useRef<number>(0)
  // Float32Array<ArrayBuffer> 명시 — strict 모드에서 getFloatFrequencyData 호환
  const dataRef        = useRef<Float32Array<ArrayBuffer> | null>(null)

  // 동적 노이즈 플로어용 히스토리 링 버퍼
  const noiseHistRef   = useRef<Array<Float32Array<ArrayBuffer>>>([]) // strict 호환
  // 지속성 추적 맵
  const persistMapRef  = useRef<PersistenceMap>(new Map())
  // 현재 동적 임계값 (디버깅용)
  const thresholdRef   = useRef<number>(-30)

  const [isActive, setIsActive]       = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [peaks, setPeaks]             = useState<PeakInfo[]>([])
  const [spectrumData, setSpectrumData] = useState<Float32Array<ArrayBuffer> | null>(null)
  const [dynamicThreshold, setDynamicThreshold] = useState<number>(-30)

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    audioCtxRef.current?.close()
    audioCtxRef.current  = null
    analyserRef.current  = null
    streamRef.current    = null
    dataRef.current      = null
    noiseHistRef.current = []
    persistMapRef.current = new Map()
    setIsActive(false)
    setPeaks([])
    setSpectrumData(null)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      const AudioCtx = window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) throw new Error('Web Audio API가 지원되지 않는 브라우저입니다.')

      const ctx      = new AudioCtx()
      const analyser = ctx.createAnalyser()
      analyser.fftSize              = FFT_SIZE
      analyser.smoothingTimeConstant = 0.85

      const source = ctx.createMediaStreamSource(stream)
      source.connect(analyser) // 스피커 연결 금지 — 피드백 루프 방지

      audioCtxRef.current  = ctx
      analyserRef.current  = analyser
      streamRef.current    = stream
      dataRef.current      = new Float32Array(analyser.frequencyBinCount)
      setIsActive(true)

      const loop = () => {
        const analyser = analyserRef.current
        const data     = dataRef.current
        if (!analyser || !data) return

        analyser.getFloatFrequencyData(data)

        // ── 스펙트럼 스냅샷 (렌더링용 복사본) ──
        const snapshot = new Float32Array(data)
        setSpectrumData(snapshot)

        // ── 동적 노이즈 플로어 업데이트 ──
        noiseHistRef.current.push(new Float32Array(data))
        if (noiseHistRef.current.length > NOISE_HISTORY) {
          noiseHistRef.current.shift()
        }
        const threshold = computeDynamicThreshold(noiseHistRef.current)
        thresholdRef.current = threshold

        // ── 다중 피크 감지 ──
        const rawPeaks = detectMultiPeaks(data, ctx.sampleRate, threshold)
        const binWidth = ctx.sampleRate / FFT_SIZE

        // ── 지속성 업데이트 ──
        persistMapRef.current = updatePersistence(rawPeaks, persistMapRef.current)

        // ── PeakInfo 조립 ──
        const peakInfos: PeakInfo[] = rawPeaks.map(p => {
          const freq             = p.bin * binWidth
          const { note, midi, cents } = freqToNote(freq)
          const eq               = getEQSuggestion(freq)
          const key              = binKey(p.bin)
          const frames           = persistMapRef.current.get(key) ?? 1
          return {
            freq,
            db:               p.db,
            note,
            midi,
            cents,
            wavelengthM:      343 / freq,
            geqBand:          eq.geqBand,
            adjacentBands:    eq.adjacentBands,
            cutDB:            eq.cutDB,
            Q:                eq.Q,
            urgency:          eq.urgency,
            confirmed:        frames >= PERSIST_FRAMES,
            persistenceFrames: frames,
          }
        })

        setPeaks(peakInfos)
        setDynamicThreshold(threshold)

        rafRef.current = requestAnimationFrame(loop)
      }
      loop()
    } catch (e) {
      const msg = e instanceof Error ? e.message : '마이크 접근 실패'
      setError(
        msg === 'Permission denied'
          ? '마이크 권한이 거부되었습니다. 브라우저 설정에서 허용해주세요.'
          : msg,
      )
    }
  }, [])

  // 하위 호환: peak = 최강 피크 (peaks[0])
  const peak = peaks[0] ?? null

  return {
    isActive,
    error,
    peaks,
    peak,           // 하위 호환 — HowlingDetector 기존 코드 유지
    spectrumData,
    dynamicThreshold,
    start,
    stop,
    sampleRate: audioCtxRef.current?.sampleRate ?? 44100,
  }
}

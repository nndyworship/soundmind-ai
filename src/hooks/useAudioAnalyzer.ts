import { useRef, useState, useCallback } from 'react'

export interface PeakInfo {
  freq: number
  db: number
  note: string
  midi: number
  cents: number
  wavelengthM: number
  geqBand: string
  cutDB: number
  Q: number
  urgency: 'critical' | 'warning' | 'info'
}

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
const GEQ_BANDS = [20,25,31.5,40,50,63,80,100,125,160,200,250,315,400,500,
                   630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,
                   8000,10000,12500,16000,20000]

const THRESHOLD_DB = -30
const FFT_SIZE = 8192

function detectPeak(data: Float32Array, sampleRate: number): { bin: number; db: number } | null {
  let maxBin = 0
  let maxVal = -Infinity
  // 시작 빈을 4로 제한 (약 20Hz 이상, DC/서브 하울링 제외)
  const startBin = Math.ceil(20 / (sampleRate / FFT_SIZE))
  for (let i = startBin; i < data.length - 1; i++) {
    if (data[i] > THRESHOLD_DB && data[i] > maxVal) {
      maxVal = data[i]
      maxBin = i
    }
  }
  if (maxVal < THRESHOLD_DB || maxBin === 0) return null

  // Parabolic interpolation으로 빈 경계 정밀 보정
  const a = data[maxBin - 1]
  const b = data[maxBin]
  const g = data[maxBin + 1]
  const denom = a - 2 * b + g
  const offset = denom !== 0 ? 0.5 * (a - g) / denom : 0

  return { bin: maxBin + offset, db: maxVal }
}

function freqToNote(freq: number): { note: string; midi: number; cents: number } {
  const midiFloat = 69 + 12 * Math.log2(freq / 440)
  const midi = Math.round(midiFloat)
  const cents = Math.round((midiFloat - midi) * 100)
  const octave = Math.floor(midi / 12) - 1
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]
  return { note: `${name}${octave}`, midi, cents }
}

function getEQSuggestion(freq: number): { geqBand: string; cutDB: number; Q: number; urgency: PeakInfo['urgency'] } {
  const closest = GEQ_BANDS.reduce((p, c) => Math.abs(c - freq) < Math.abs(p - freq) ? c : p)
  const urgency: PeakInfo['urgency'] = freq < 2000 ? 'critical' : freq < 6000 ? 'warning' : 'info'
  return {
    geqBand: closest >= 1000 ? `${closest / 1000}kHz` : `${closest}Hz`,
    cutDB: urgency === 'critical' ? -6 : -3,
    Q: urgency === 'critical' ? 4.0 : 2.0,
    urgency,
  }
}

export function useAudioAnalyzer() {
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef   = useRef<MediaStream | null>(null)
  const rafRef      = useRef<number>(0)
  const dataRef     = useRef<Float32Array<ArrayBuffer> | null>(null)

  const [isActive, setIsActive]   = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [peak, setPeak]           = useState<PeakInfo | null>(null)
  const [spectrumData, setSpectrumData] = useState<Float32Array<ArrayBuffer> | null>(null)

  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach(t => t.stop())
    audioCtxRef.current?.close()
    audioCtxRef.current = null
    analyserRef.current = null
    streamRef.current   = null
    dataRef.current     = null
    setIsActive(false)
    setPeak(null)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      // iOS Safari: AudioContext는 반드시 유저 제스처 직후 생성
      const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) throw new Error('Web Audio API가 지원되지 않는 브라우저입니다.')

      const ctx      = new AudioCtx()
      const analyser = ctx.createAnalyser()
      analyser.fftSize             = FFT_SIZE
      analyser.smoothingTimeConstant = 0.85

      const source = ctx.createMediaStreamSource(stream)
      source.connect(analyser)
      // 스피커 연결 금지 → 피드백 루프 방지

      audioCtxRef.current = ctx
      analyserRef.current = analyser
      streamRef.current   = stream
      dataRef.current     = new Float32Array(analyser.frequencyBinCount) as Float32Array<ArrayBuffer>
      setIsActive(true)

      const loop = () => {
        if (!analyserRef.current || !dataRef.current) return
        analyserRef.current.getFloatFrequencyData(dataRef.current)

        // 스펙트럼 복사본 (렌더링용)
        setSpectrumData(new Float32Array(dataRef.current))

        const sampleRate = ctx.sampleRate
        const binWidth   = sampleRate / FFT_SIZE
        const result     = detectPeak(dataRef.current, sampleRate)

        if (result) {
          const freq = result.bin * binWidth
          const { note, midi, cents } = freqToNote(freq)
          const { geqBand, cutDB, Q, urgency } = getEQSuggestion(freq)
          setPeak({ freq, db: result.db, note, midi, cents, wavelengthM: 343 / freq, geqBand, cutDB, Q, urgency })
        } else {
          setPeak(null)
        }

        rafRef.current = requestAnimationFrame(loop)
      }
      loop()
    } catch (e) {
      const msg = e instanceof Error ? e.message : '마이크 접근 실패'
      setError(msg === 'Permission denied' ? '마이크 권한이 거부되었습니다. 브라우저 설정에서 허용해주세요.' : msg)
    }
  }, [])

  return { isActive, error, peak, spectrumData, start, stop, sampleRate: audioCtxRef.current?.sampleRate ?? 44100 }
}

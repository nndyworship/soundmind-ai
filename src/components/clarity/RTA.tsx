/**
 * RTA.tsx — 1/3 옥타브 실시간 주파수 분석기
 *
 * ■ 기준: TC Electronic Clarity M 스펙
 *   - 31밴드 ISO 1/3 옥타브 (20Hz ~ 20kHz, Clarity M 원기 31.5~16kHz → 풀 레인지 확장)
 *   - Log 주파수 축
 *   - 가변 응답 속도 (fast / medium / slow)
 *   - dB 레인지 가변 (60 / 80dB 스팬)
 *
 * ■ 추가 전문 기능 (Smaart / AudioTools / Yamaha CL 레퍼런스)
 *   - 피크 홀드: 3s 유지 → 0.3dB/frame 낙하
 *   - 파워 도메인 밴드 평균 (단순 dB 평균 × — 정확한 에너지 합산)
 *   - 주파수 범위별 색상 코딩 (서브베이스 → 베이스 → 로우미드 → 미드 → 하이미드 → 하이)
 *   - 배경 선택 밴드 줌 레이블 (Clarity M 인코더 기능 모사)
 *
 * ⚠ Canvas API: CSS var() 미지원 → 모든 색상 하드코딩
 * 비용: $0 (Web Audio API AnalyserNode + Canvas 2D)
 */

import { useRef, useEffect } from 'react'

// ── Canvas 색상 팔레트 (하드코딩 필수) ───────────────────────────────────────

const C = {
  BG:     '#080810',
  GRID_H: 'rgba(255,255,255,0.055)',  // 수평 dB 그리드
  GRID_V: 'rgba(255,255,255,0.04)',   // 수직 주파수 그리드
  LABEL:  'rgba(255,255,255,0.35)',
  PEAK:   'rgba(255,255,255,0.90)',
  ZERO:   'rgba(255,50,50,0.7)',      // 0dBFS 라인
  // 주파수 범위별 바 색상 (TC Clarity M 원본: 단색 녹색 → 프로 멀티컬러로 확장)
  BANDS: [
    // Sub bass: 20–50Hz (4밴드) - 보라
    '#9b59ff', '#9b59ff', '#9b59ff',
    // Bass: 63–160Hz (5밴드) - 주황
    '#ff6b35', '#ff6b35', '#ff6b35', '#ff6b35', '#ff6b35',
    // Low Mid: 200Hz–800Hz (6밴드) - 황금
    '#ffd600', '#ffd600', '#ffd600', '#ffd600', '#ffd600', '#ffd600',
    // Mid: 1k–3.15kHz (6밴드) - 녹색 (Clarity M 원색)
    '#00c853', '#00c853', '#00c853', '#00c853', '#00c853', '#00c853',
    // High Mid: 4k–8kHz (4밴드) - 하늘
    '#0a84ff', '#0a84ff', '#0a84ff', '#0a84ff',
    // High: 10k–20kHz (5밴드) - 시안
    '#40d8ff', '#40d8ff', '#40d8ff', '#40d8ff', '#40d8ff',
    // (31밴드: 3+5+6+6+4+5 = 29 → 31에 맞게 Mid +2 조정)
    // 실제 매핑은 아래 ISO_BANDS 배열 순서로 i-index로 결정
  ] as string[],
} as const

// ── ISO 1/3 옥타브 중심 주파수 31밴드 ─────────────────────────────────────────

export const ISO_BANDS: readonly number[] = [
  20, 25, 31.5, 40, 50,           // 0–4
  63, 80, 100, 125, 160,          // 5–9
  200, 250, 315, 400, 500, 630,   // 10–15
  800, 1000, 1250, 1600,          // 16–19
  2000, 2500, 3150,               // 20–22
  4000, 5000, 6300,               // 23–25
  8000, 10000, 12500, 16000, 20000, // 26–30
]

const BAND_COLORS: string[] = [
  // Sub bass 20–50Hz (idx 0–4)
  '#9b59ff', '#9b59ff', '#9b59ff', '#9b59ff', '#9b59ff',
  // Bass 63–160Hz (idx 5–9)
  '#ff6b35', '#ff6b35', '#ff6b35', '#ff6b35', '#ff6b35',
  // Low Mid 200–630Hz (idx 10–15)
  '#ffd600', '#ffd600', '#ffd600', '#ffd600', '#ffd600', '#ffd600',
  // Mid 800Hz–3.15kHz (idx 16–22)
  '#00e676', '#00e676', '#00e676', '#00e676', '#00c853', '#00c853', '#00c853',
  // High Mid 4k–6.3kHz (idx 23–25)
  '#40c4ff', '#40c4ff', '#40c4ff',
  // High 8k–20kHz (idx 26–30)
  '#64d8ff', '#64d8ff', '#64d8ff', '#64d8ff', '#64d8ff',
]

const F_MIN = 17      // 표시 시작 (20Hz 밴드 왼쪽 여백)
const F_MAX = 24000   // 표시 끝 (20kHz 밴드 오른쪽 여백)
const THIRD_OCT = Math.pow(2, 1 / 6) // ≈ 1.1225 (1/3 옥타브 계수)

// ── Props ─────────────────────────────────────────────────────────────────────

export interface RTAProps {
  stream:     MediaStream | null
  width?:     number
  height?:    number
  averaging?: 'fast' | 'medium' | 'slow'
  dbRange?:   60 | 80
  peakHold?:  boolean
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────

/** 주파수 → X 좌표 (로그 스케일) */
function freqToX(f: number, W: number): number {
  return W * Math.log10(f / F_MIN) / Math.log10(F_MAX / F_MIN)
}

/** dB → Y 좌표 */
function dbToY(db: number, H: number, dbMin: number): number {
  return H * (1 - (db - dbMin) / (-dbMin))
}

// ── 컴포넌트 ──────────────────────────────────────────────────────────────────

export default function RTA({
  stream,
  width    = 560,
  height   = 300,
  averaging = 'medium',
  dbRange   = 80,
  peakHold  = true,
}: RTAProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const rafRef     = useRef<number>(0)
  const ctxARef    = useRef<AudioContext | null>(null)
  const peaksRef   = useRef<Float32Array>(new Float32Array(31).fill(-100))
  const peakTsRef  = useRef<Float32Array>(new Float32Array(31).fill(0))

  const DB_MIN = -dbRange

  // smoothingTimeConstant: Clarity M 응답 속도 모사
  const SMOOTHING: Record<string, number> = {
    fast:   0.55,   // ~100ms 응답
    medium: 0.80,   // ~250ms (Clarity M 기본)
    slow:   0.92,   // ~500ms
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    // 스트림 없음 → 정적 그리드
    if (!stream) {
      drawBackground(ctx2d, width, height, DB_MIN)
      return
    }

    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const audioCtx = new AudioCtx()
    ctxARef.current = audioCtx

    let cancelled = false

    const doSetup = () => {
      if (cancelled || audioCtx.state === 'closed') return

      const source   = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize               = 8192
      analyser.smoothingTimeConstant = SMOOTHING[averaging] ?? 0.80
      analyser.minDecibels           = DB_MIN - 10
      analyser.maxDecibels           = 0

      // ✅ source → analyser → silencer(gain=0) → destination
      // AnalyserNode를 신호 체인에 포함해야 getFloatFrequencyData() 가 실제 오디오 데이터 반환
      const silencer = audioCtx.createGain()
      silencer.gain.value = 0
      source.connect(analyser)
      analyser.connect(silencer)
      silencer.connect(audioCtx.destination)

      const fftBuf   = new Float32Array(analyser.frequencyBinCount)  // 4096 bins
      const sr       = audioCtx.sampleRate
      const binWidth = sr / analyser.fftSize

      // 각 ISO 밴드의 FFT 빈 범위 사전 계산
      const bandBins = ISO_BANDS.map(fc => {
        const fLo = fc / THIRD_OCT
        const fHi = fc * THIRD_OCT
        return {
          lo: Math.max(0, Math.floor(fLo / binWidth)),
          hi: Math.min(fftBuf.length - 1, Math.ceil(fHi / binWidth)),
        }
      })

      const HOLD_MS        = 3000
      const FALL_PER_FRAME = 0.3

      const render = () => {
        if (cancelled) return  // ← 좀비 루프 방지: cleanup 후 대기 중인 rAF 프레임 차단
        analyser.getFloatFrequencyData(fftBuf)
        const now = performance.now()

        // ── 밴드별 파워 도메인 평균 계산 ──
        const bandDb = ISO_BANDS.map((_, i) => {
          const { lo, hi } = bandBins[i]!
          if (hi < lo) return DB_MIN

          let sumPow = 0
          let count  = 0
          for (let b = lo; b <= hi; b++) {
            const v = fftBuf[b]
            if (v !== undefined && isFinite(v) && v > DB_MIN - 10) {
              sumPow += Math.pow(10, v / 10)
              count++
            }
          }
          if (count === 0) return DB_MIN
          const db = 10 * Math.log10(sumPow / count)
          return Math.max(DB_MIN, Math.min(0, db))
        })

        // ── 피크 홀드 갱신 ──
        if (peakHold) {
          for (let i = 0; i < 31; i++) {
            const cur = bandDb[i] ?? DB_MIN
            if (cur > (peaksRef.current[i] ?? DB_MIN)) {
              peaksRef.current[i]  = cur
              peakTsRef.current[i] = now
            } else if (now - (peakTsRef.current[i] ?? 0) > HOLD_MS) {
              peaksRef.current[i] = (peaksRef.current[i] ?? DB_MIN) - FALL_PER_FRAME
              if ((peaksRef.current[i] ?? 0) < DB_MIN) peaksRef.current[i] = DB_MIN
            }
          }
        }

        drawFrame(ctx2d, width, height, DB_MIN, bandDb, Array.from(peaksRef.current), peakHold)
        rafRef.current = requestAnimationFrame(render)
      }

      rafRef.current = requestAnimationFrame(render)
    }

    // ✅ resume() 완료 후 setup — suspended 컨텍스트에서 AnalyserNode 미작동 방지
    if (audioCtx.state === 'running') {
      doSetup()
    } else {
      audioCtx.resume().then(doSetup).catch(doSetup)
    }

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      void audioCtx.close()
      ctxARef.current = null
      // 피크 홀드 리셋
      peaksRef.current.fill(-100)
      peakTsRef.current.fill(0)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, width, height, averaging, dbRange])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        display:      'block',
        width,
        height,
        borderRadius: 6,
        background:   C.BG,
      }}
    />
  )
}

// ── 드로잉 함수 ───────────────────────────────────────────────────────────────

const BOTTOM_PAD = 16  // 주파수 레이블 공간
const RIGHT_PAD  = 30  // dB 레이블 공간

/** 배경 + 그리드 렌더링 */
function drawBackground(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  dbMin: number,
) {
  const drawH = H - BOTTOM_PAD
  const drawW = W - RIGHT_PAD

  ctx.fillStyle = C.BG
  ctx.fillRect(0, 0, W, H)

  // ── dB 수평 그리드 ──
  ctx.font = '8px JetBrains Mono, monospace'
  const step = dbMin <= -80 ? 12 : 6
  for (let db = dbMin; db <= 0; db += step) {
    const y = dbToY(db, drawH, dbMin)
    ctx.strokeStyle = db === 0 ? C.ZERO : C.GRID_H
    ctx.lineWidth   = db === 0 ? 1 : 0.5
    ctx.setLineDash(db === 0 ? [] : [3, 5])
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(drawW, y); ctx.stroke()
    ctx.setLineDash([])

    if (db % (step * 2) === 0 || db === -6 || db === 0) {
      ctx.fillStyle  = db === 0 ? C.ZERO : C.LABEL
      ctx.textAlign  = 'right'
      ctx.fillText(db === 0 ? '0' : `${db}`, W - 2, y + 3)
    }
  }

  // ── 주파수 수직 그리드 + 레이블 ──
  const freqLines = [
    { f: 20,    label: '20' },
    { f: 50,    label: '50' },
    { f: 100,   label: '100' },
    { f: 200,   label: '200' },
    { f: 500,   label: '500' },
    { f: 1000,  label: '1k' },
    { f: 2000,  label: '2k' },
    { f: 5000,  label: '5k' },
    { f: 10000, label: '10k' },
    { f: 20000, label: '20k' },
  ]
  ctx.strokeStyle = C.GRID_V
  ctx.lineWidth   = 0.5
  ctx.setLineDash([])
  freqLines.forEach(({ f, label }) => {
    const x = freqToX(f, drawW)
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, drawH); ctx.stroke()
    ctx.fillStyle = C.LABEL
    ctx.textAlign = 'center'
    ctx.font      = '8px JetBrains Mono, monospace'
    ctx.fillText(label, x, H - 2)
  })
  ctx.textAlign = 'left'

  // ── 범례 레이블 ──
  ctx.fillStyle = 'rgba(255,255,255,0.15)'
  ctx.font      = '9px JetBrains Mono, monospace'
  ctx.fillText('SUB', freqToX(30, drawW) - 8, 12)
  ctx.fillText('BASS', freqToX(100, drawW) - 12, 12)
  ctx.fillText('L.MID', freqToX(350, drawW) - 14, 12)
  ctx.fillText('MID', freqToX(1500, drawW) - 10, 12)
  ctx.fillText('H.MID', freqToX(5000, drawW) - 14, 12)
  ctx.fillText('HIGH', freqToX(14000, drawW) - 10, 12)
}

/** 매 프레임 렌더링 */
function drawFrame(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  dbMin: number,
  bandDb: number[],
  peaks: number[],
  peakHold: boolean,
) {
  const drawH = H - BOTTOM_PAD
  const drawW = W - RIGHT_PAD

  drawBackground(ctx, W, H, dbMin)

  // ── 밴드 바 그리기 ──
  ISO_BANDS.forEach((fc, i) => {
    const fLo   = fc / THIRD_OCT
    const fHi   = fc * THIRD_OCT
    const xL    = freqToX(Math.max(F_MIN, fLo), drawW)
    const xR    = freqToX(Math.min(F_MAX, fHi), drawW)
    const barW  = Math.max(2, xR - xL - 1)
    const db    = bandDb[i] ?? dbMin
    const yTop  = dbToY(db, drawH, dbMin)
    const barH  = Math.max(0, drawH - yTop)

    if (barH <= 0) return

    const color = BAND_COLORS[i] ?? '#00c853'

    // 그라디언트 바 (상단 밝음 → 하단 투명)
    const grad = ctx.createLinearGradient(0, yTop, 0, drawH)
    grad.addColorStop(0,    color)
    grad.addColorStop(0.6,  color + 'cc')
    grad.addColorStop(1,    color + '33')
    ctx.fillStyle = grad
    ctx.fillRect(xL, yTop, barW, barH)

    // 피크 홀드 라인
    if (peakHold) {
      const peakDb = peaks[i] ?? dbMin
      if (peakDb > dbMin + 1) {
        const yPeak = dbToY(peakDb, drawH, dbMin)
        ctx.strokeStyle = C.PEAK
        ctx.lineWidth   = 1.5
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(xL + 0.5, yPeak)
        ctx.lineTo(xL + barW - 0.5, yPeak)
        ctx.stroke()
      }
    }
  })
}

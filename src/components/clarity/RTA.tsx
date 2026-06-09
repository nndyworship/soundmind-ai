/**
 * RTA.tsx — 1/3 옥타브 실시간 주파수 분석기
 *
 * ✅ 단일 공유 AudioContext 사용 (useSharedAudio에서 전달받은 audioCtx/srcNode)
 *    - 독립 AudioContext 생성 제거 → Chrome 다중 AudioContext 버그 해결
 *    - AnalyserNode만 생성/연결/해제
 *
 * ■ 31밴드 ISO 1/3 옥타브 (20Hz ~ 20kHz)
 * ■ Log 주파수 축, 가변 응답 속도, 가변 dB 레인지
 * ■ 피크 홀드, 파워 도메인 밴드 평균, 주파수 범위별 색상
 *
 * ⚠ Canvas API: CSS var() 미지원 → 모든 색상 하드코딩
 * 비용: $0
 */

import { useRef, useEffect } from 'react'

const C = {
  BG:     '#080810',
  GRID_H: 'rgba(255,255,255,0.055)',
  GRID_V: 'rgba(255,255,255,0.04)',
  LABEL:  'rgba(255,255,255,0.35)',
  PEAK:   'rgba(255,255,255,0.90)',
  ZERO:   'rgba(255,50,50,0.7)',
  BANDS:  [] as string[],
} as const

export const ISO_BANDS: readonly number[] = [
  20, 25, 31.5, 40, 50,
  63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630,
  800, 1000, 1250, 1600,
  2000, 2500, 3150,
  4000, 5000, 6300,
  8000, 10000, 12500, 16000, 20000,
]

const BAND_COLORS: string[] = [
  '#9b59ff', '#9b59ff', '#9b59ff', '#9b59ff', '#9b59ff',
  '#ff6b35', '#ff6b35', '#ff6b35', '#ff6b35', '#ff6b35',
  '#ffd600', '#ffd600', '#ffd600', '#ffd600', '#ffd600', '#ffd600',
  '#00e676', '#00e676', '#00e676', '#00e676', '#00c853', '#00c853', '#00c853',
  '#40c4ff', '#40c4ff', '#40c4ff',
  '#64d8ff', '#64d8ff', '#64d8ff', '#64d8ff', '#64d8ff',
]

const F_MIN    = 17
const F_MAX    = 24000
const THIRD_OCT = Math.pow(2, 1 / 6)

export interface RTAProps {
  audioCtx:   AudioContext | null
  srcNode:    AudioNode | null
  width?:     number
  height?:    number
  averaging?: 'fast' | 'medium' | 'slow'
  dbRange?:   60 | 80
  peakHold?:  boolean
}

function freqToX(f: number, W: number): number {
  return W * Math.log10(f / F_MIN) / Math.log10(F_MAX / F_MIN)
}

function dbToY(db: number, H: number, dbMin: number): number {
  return H * (1 - (db - dbMin) / (-dbMin))
}

export default function RTA({
  audioCtx,
  srcNode,
  width     = 560,
  height    = 300,
  averaging = 'medium',
  dbRange   = 80,
  peakHold  = true,
}: RTAProps) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const rafRef     = useRef<number>(0)
  const peaksRef   = useRef<Float32Array>(new Float32Array(31).fill(-100))
  const peakTsRef  = useRef<Float32Array>(new Float32Array(31).fill(0))

  const DB_MIN = -dbRange

  const SMOOTHING: Record<string, number> = {
    fast:   0.55,
    medium: 0.80,
    slow:   0.92,
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    if (!audioCtx || !srcNode) {
      drawBackground(ctx2d, width, height, DB_MIN)
      return
    }

    let cancelled = false

    const analyser = audioCtx.createAnalyser()
    analyser.fftSize               = 8192
    analyser.smoothingTimeConstant = SMOOTHING[averaging] ?? 0.80
    analyser.minDecibels           = DB_MIN - 10
    analyser.maxDecibels           = 0

    const silencer = audioCtx.createGain()
    silencer.gain.value = 0
    srcNode.connect(analyser)
    analyser.connect(silencer)
    silencer.connect(audioCtx.destination)

    const fftBuf   = new Float32Array(analyser.frequencyBinCount)
    const sr       = audioCtx.sampleRate
    const binWidth = sr / analyser.fftSize

    const bandBins = ISO_BANDS.map(fc => ({
      lo: Math.max(0, Math.floor(fc / THIRD_OCT / binWidth)),
      hi: Math.min(fftBuf.length - 1, Math.ceil(fc * THIRD_OCT / binWidth)),
    }))

    const HOLD_MS        = 3000
    const FALL_PER_FRAME = 0.3

    const render = () => {
      if (cancelled) return
      analyser.getFloatFrequencyData(fftBuf)
      const now = performance.now()

      const bandDb = ISO_BANDS.map((_, i) => {
        const { lo, hi } = bandBins[i]!
        if (hi < lo) return DB_MIN
        let sumPow = 0, count = 0
        for (let b = lo; b <= hi; b++) {
          const v = fftBuf[b]
          if (v !== undefined && isFinite(v) && v > DB_MIN - 10) {
            sumPow += Math.pow(10, v / 10)
            count++
          }
        }
        if (count === 0) return DB_MIN
        return Math.max(DB_MIN, Math.min(0, 10 * Math.log10(sumPow / count)))
      })

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

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      try { analyser.disconnect() } catch {}
      try { silencer.disconnect() } catch {}
      peaksRef.current.fill(-100)
      peakTsRef.current.fill(0)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioCtx, srcNode, width, height, averaging, dbRange])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        display: 'block', width, height,
        borderRadius: 6,
        background:   C.BG,
      }}
    />
  )
}

// ── 드로잉 함수 ───────────────────────────────────────────────────────────────

const BOTTOM_PAD = 16
const RIGHT_PAD  = 30

function drawBackground(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  dbMin: number,
) {
  const drawH = H - BOTTOM_PAD
  const drawW = W - RIGHT_PAD

  ctx.fillStyle = C.BG
  ctx.fillRect(0, 0, W, H)

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
      ctx.fillStyle = db === 0 ? C.ZERO : C.LABEL
      ctx.textAlign = 'right'
      ctx.fillText(db === 0 ? '0' : `${db}`, W - 2, y + 3)
    }
  }

  const freqLines = [
    { f: 20,    label: '20'  },
    { f: 50,    label: '50'  },
    { f: 100,   label: '100' },
    { f: 200,   label: '200' },
    { f: 500,   label: '500' },
    { f: 1000,  label: '1k'  },
    { f: 2000,  label: '2k'  },
    { f: 5000,  label: '5k'  },
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

  ctx.fillStyle = 'rgba(255,255,255,0.15)'
  ctx.font      = '9px JetBrains Mono, monospace'
  ctx.fillText('SUB',   freqToX(30,    drawW) - 8,  12)
  ctx.fillText('BASS',  freqToX(100,   drawW) - 12, 12)
  ctx.fillText('L.MID', freqToX(350,   drawW) - 14, 12)
  ctx.fillText('MID',   freqToX(1500,  drawW) - 10, 12)
  ctx.fillText('H.MID', freqToX(5000,  drawW) - 14, 12)
  ctx.fillText('HIGH',  freqToX(14000, drawW) - 10, 12)
}

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

  ISO_BANDS.forEach((fc, i) => {
    const fLo  = fc / THIRD_OCT
    const fHi  = fc * THIRD_OCT
    const xL   = freqToX(Math.max(F_MIN, fLo), drawW)
    const xR   = freqToX(Math.min(F_MAX, fHi), drawW)
    const barW = Math.max(2, xR - xL - 1)
    const db   = bandDb[i] ?? dbMin
    const yTop = dbToY(db, drawH, dbMin)
    const barH = Math.max(0, drawH - yTop)

    if (barH <= 0) return

    const color = BAND_COLORS[i] ?? '#00c853'
    const grad  = ctx.createLinearGradient(0, yTop, 0, drawH)
    grad.addColorStop(0,   color)
    grad.addColorStop(0.6, color + 'cc')
    grad.addColorStop(1,   color + '33')
    ctx.fillStyle = grad
    ctx.fillRect(xL, yTop, barW, barH)

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

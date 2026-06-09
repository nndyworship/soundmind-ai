/**
 * Goniometer.tsx — Lissajous Phase Scope
 *
 * ✅ 단일 공유 AudioContext 사용 (useSharedAudio에서 전달받은 audioCtx/srcNode)
 *    - 독립 AudioContext 생성 제거 → Chrome 다중 AudioContext 버그 해결
 *    - 자신의 ScriptProcessor만 생성/연결/해제
 *
 * ✅ onaudioprocess ↔ rAF 분리
 *    - onaudioprocess: 상관계수 계산 + 샘플 저장 ONLY
 *    - rAF tick (60fps): 드로잉 전담
 *
 * ⚠ Canvas API는 CSS var() 미지원 — 모든 색상 하드코딩
 * 비용: $0
 */

import { useRef, useEffect, useCallback } from 'react'

const C = {
  BG:      '#0d0d10',
  BORDER:  '#2a2a30',
  GRID:    'rgba(255,255,255,0.06)',
  CROSS:   '#2a2a30',
  OK:      '#00c853',
  CAUTION: '#ffd600',
  DANGER:  '#ff1744',
  LABEL:   'rgba(255,255,255,0.20)',
  GHOST:   'rgba(13,13,16,0.18)',
} as const

const SQRT2 = Math.SQRT2

interface GoniometerProps {
  audioCtx: AudioContext | null
  srcNode:  AudioNode | null
  width?:   number
  height?:  number
}

export default function Goniometer({ audioCtx, srcNode, width = 280, height = 280 }: GoniometerProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const rafRef       = useRef<number>(0)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const samplesRef   = useRef<{ L: Float32Array; R: Float32Array } | null>(null)

  const drawStatic = useCallback((ctx2d: CanvasRenderingContext2D, W: number, H: number) => {
    const cx = W / 2, cy = H / 2
    const r  = Math.min(W, H) * 0.46

    ctx2d.fillStyle = C.BG
    ctx2d.fillRect(0, 0, W, H)

    ctx2d.strokeStyle = C.GRID
    ctx2d.lineWidth   = 1
    ;[[-1, 1] as const, [1, 1] as const].forEach(([sx, sy]) => {
      ctx2d.beginPath()
      ctx2d.moveTo(cx, cy)
      ctx2d.lineTo(cx + sx * r, cy - sy * r)
      ctx2d.stroke()
    })

    ctx2d.strokeStyle = C.CROSS
    ctx2d.lineWidth   = 1
    ctx2d.beginPath()
    ctx2d.moveTo(cx - r, cy); ctx2d.lineTo(cx + r, cy)
    ctx2d.moveTo(cx, cy - r); ctx2d.lineTo(cx, cy + r)
    ctx2d.stroke()

    ctx2d.fillStyle = C.LABEL
    ctx2d.font      = '9px JetBrains Mono, monospace'
    ctx2d.textAlign = 'center'
    ctx2d.fillText('L', cx - r + 10, cy - 6)
    ctx2d.fillText('R', cx + r - 10, cy - 6)
    ctx2d.fillText('M', cx, cy - r + 14)
    ctx2d.fillText('S', cx, cy + r - 4)
    ctx2d.textAlign = 'left'
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    if (!audioCtx || !srcNode) {
      ctx2d.clearRect(0, 0, width, height)
      drawStatic(ctx2d, width, height)
      return
    }

    let cancelled     = false
    let correlation   = 0
    let hasNewSamples = false

    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const processor = audioCtx.createScriptProcessor(2048, 2, 2)
    processorRef.current = processor

    const silencer = audioCtx.createGain()
    silencer.gain.value = 0

    // ✅ onaudioprocess: 연산 + 저장만 — 캔버스 조작 없음
    processor.onaudioprocess = (ev) => {
      if (cancelled) return
      const inputL = ev.inputBuffer.getChannelData(0)
      const inputR = ev.inputBuffer.numberOfChannels > 1
        ? ev.inputBuffer.getChannelData(1)
        : inputL

      let sumLR = 0, sumL2 = 0, sumR2 = 0
      for (let i = 0; i < inputL.length; i++) {
        sumLR += inputL[i]! * inputR[i]!
        sumL2 += inputL[i]! * inputL[i]!
        sumR2 += inputR[i]! * inputR[i]!
      }
      const denom = Math.sqrt(sumL2 * sumR2)
      correlation = denom > 1e-10 ? Math.max(-1, Math.min(1, sumLR / denom)) : 0

      samplesRef.current = {
        L: Float32Array.from(inputL),
        R: Float32Array.from(inputR),
      }
      hasNewSamples = true
    }

    srcNode.connect(processor)
    processor.connect(silencer)
    silencer.connect(audioCtx.destination)

    // ── rAF 렌더링 루프 ──────────────────────────────────────────────────────
    const tick = () => {
      if (cancelled) return

      if (hasNewSamples && samplesRef.current) {
        hasNewSamples = false
        const { L, R } = samplesRef.current

        ctx2d.fillStyle = C.GHOST
        ctx2d.fillRect(0, 0, width, height)
        drawStatic(ctx2d, width, height)

        const dotColor = correlation < -0.5 ? C.DANGER
          : correlation < 0.3              ? C.CAUTION
          :                                  C.OK

        ctx2d.fillStyle   = dotColor
        ctx2d.globalAlpha = 0.85

        const cx  = width  / 2
        const cy  = height / 2
        const scl = Math.min(width, height) * 0.44

        for (let i = 0; i < L.length; i += 4) {
          const Lv = L[i]!, Rv = R[i]!
          ctx2d.fillRect(cx + (Lv + Rv) / SQRT2 * scl, cy - (Lv - Rv) / SQRT2 * scl, 1.5, 1.5)
        }
        ctx2d.globalAlpha = 1
      }

      if (correlation < -0.5) {
        ctx2d.strokeStyle = C.DANGER
        ctx2d.lineWidth   = 2
        ctx2d.strokeRect(1, 1, width - 2, height - 2)
      }

      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafRef.current)
      try { processor.disconnect() } catch {}
      try { silencer.disconnect() } catch {}
      processorRef.current = null
      samplesRef.current   = null
    }
  }, [audioCtx, srcNode, width, height, drawStatic])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        width, height,
        display:      'block',
        borderRadius: 8,
        border:       `1px solid ${C.BORDER}`,
        background:   C.BG,
      }}
    />
  )
}

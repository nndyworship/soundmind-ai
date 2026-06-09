/**
 * CorrelationMeter.tsx — 스테레오 위상 상관계수 미터
 *
 * ✅ 단일 공유 AudioContext 사용 (useSharedAudio에서 전달받은 audioCtx/srcNode)
 *    - 독립 AudioContext 생성 제거 → Chrome 다중 AudioContext 버그 해결
 *
 * ⚠ Canvas API는 CSS var() 미지원 — 모든 색상 하드코딩
 * 비용: $0
 */

import { useRef, useEffect, useState } from 'react'

const C = {
  BG:      '#0d0d10',
  OK:      '#00c853',
  CAUTION: '#ffd600',
  DANGER:  '#ff1744',
} as const

interface CorrelationMeterProps {
  audioCtx: AudioContext | null
  srcNode:  AudioNode | null
}

export default function CorrelationMeter({ audioCtx, srcNode }: CorrelationMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [corr, setCorr] = useState<number>(0)
  const procRef   = useRef<ScriptProcessorNode | null>(null)

  const W = 200
  const H = 36

  // ── 오디오 처리 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!audioCtx || !srcNode) {
      setCorr(0)
      return
    }

    let cancelled = false

    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const proc     = audioCtx.createScriptProcessor(2048, 2, 2)
    procRef.current = proc

    const silencer = audioCtx.createGain()
    silencer.gain.value = 0

    proc.onaudioprocess = (ev) => {
      if (cancelled) return
      const L = ev.inputBuffer.getChannelData(0)
      const R = ev.inputBuffer.numberOfChannels > 1
        ? ev.inputBuffer.getChannelData(1)
        : L

      let sumLR = 0, sumL2 = 0, sumR2 = 0
      for (let i = 0; i < L.length; i++) {
        sumLR += L[i]! * R[i]!
        sumL2 += L[i]! * L[i]!
        sumR2 += R[i]! * R[i]!
      }
      const denom = Math.sqrt(sumL2 * sumR2)
      setCorr(denom > 1e-10 ? Math.max(-1, Math.min(1, sumLR / denom)) : 0)
    }

    srcNode.connect(proc)
    proc.connect(silencer)
    silencer.connect(audioCtx.destination)

    return () => {
      cancelled = true
      try { proc.disconnect() } catch {}
      try { silencer.disconnect() } catch {}
      procRef.current = null
    }
  }, [audioCtx, srcNode])

  // ── Canvas 렌더링 ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = C.BG
    ctx.fillRect(0, 0, W, H)

    // 레이블 (바 위)
    ctx.font      = '9px JetBrains Mono, monospace'
    ctx.textAlign = 'left'
    ctx.fillStyle = 'rgba(255,255,255,0.4)'
    ctx.fillText('-1', 4, 11)
    ctx.textAlign = 'center'
    ctx.fillText('0', W / 2, 11)
    ctx.textAlign = 'right'
    ctx.fillText('+1', W - 4, 11)
    ctx.textAlign = 'left'

    // 배경 바
    ctx.fillStyle = 'rgba(255,255,255,0.07)'
    ctx.fillRect(4, 14, W - 8, 9)

    const barW  = W - 8
    const zeroX = 4 + barW / 2
    const corrX = 4 + ((corr + 1) / 2) * barW

    // 그라디언트
    const grad = ctx.createLinearGradient(4, 0, 4 + barW, 0)
    grad.addColorStop(0,   C.DANGER)
    grad.addColorStop(0.5, C.CAUTION)
    grad.addColorStop(1,   C.OK)
    ctx.fillStyle  = grad
    ctx.globalAlpha = 0.3
    ctx.fillRect(4, 14, barW, 9)
    ctx.globalAlpha = 1

    // 레벨 인디케이터
    const color = corr >= 0.3 ? C.OK : corr >= -0.3 ? C.CAUTION : C.DANGER
    ctx.fillStyle = color
    if (corr >= 0) {
      ctx.fillRect(zeroX, 14, corrX - zeroX, 9)
    } else {
      ctx.fillRect(corrX, 14, zeroX - corrX, 9)
    }

    // 중심선
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.fillRect(zeroX - 1, 10, 2, 14)

    // 수치
    ctx.font      = 'bold 12px JetBrains Mono, monospace'
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.fillText(corr.toFixed(2), W / 2, H - 2)
    ctx.textAlign = 'left'
  }, [corr])

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        style={{ display: 'block', width: W, height: H }}
      />
    </div>
  )
}

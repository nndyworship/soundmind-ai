/**
 * Goniometer.tsx — Lissajous Phase Scope
 *
 * ✅ 오디오 처리(onaudioprocess)와 렌더링(requestAnimationFrame) 완전 분리
 *    - onaudioprocess: 상관계수 계산 + 샘플 저장 ONLY (캔버스 조작 0)
 *    - rAF tick (60fps): 저장된 샘플로 실제 드로잉
 *    → 메인 스레드 11,000+ops/sec 부하 제거 → 프리징 방지
 *
 * ⚠ Canvas API는 CSS var() 미지원 — 모든 색상 하드코딩
 *
 * X = (L+R)/√2 (Mid), Y = (L−R)/√2 (Side)
 * 잔상: 새 오디오 프레임 도착 시에만 ghost overlay (속도 유지)
 * 상관계수 < 0.3 → caution(#ffd600), < -0.5 → danger(#ff1744)
 *
 * 비용: $0 (Web Audio API, Canvas 2D)
 */

import { useRef, useEffect, useCallback } from 'react'

// Canvas API는 CSS var() 지원 안 함 → 하드코딩
const C = {
  BG:        '#0d0d10',
  BORDER:    '#2a2a30',
  GRID:      'rgba(255,255,255,0.06)',
  CROSS:     '#2a2a30',
  OK:        '#00c853',
  CAUTION:   '#ffd600',
  DANGER:    '#ff1744',
  LABEL:     'rgba(255,255,255,0.20)',
  GHOST:     'rgba(13,13,16,0.18)',
} as const

const SQRT2 = Math.SQRT2

interface GoniometerProps {
  stream:  MediaStream | null
  width?:  number
  height?: number
}

export default function Goniometer({ stream, width = 280, height = 280 }: GoniometerProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null)
  const rafRef       = useRef<number>(0)
  const ctxRef       = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  // onaudioprocess → rAF 간 샘플 전달용 ref (캔버스 조작을 rAF로 옮기기 위함)
  const samplesRef   = useRef<{ L: Float32Array; R: Float32Array } | null>(null)

  // ── 정적 배경 그리기 ─────────────────────────────────────────────────────
  const drawStatic = useCallback((ctx2d: CanvasRenderingContext2D, W: number, H: number) => {
    const cx = W / 2
    const cy = H / 2
    const r  = Math.min(W, H) * 0.46

    ctx2d.fillStyle = C.BG
    ctx2d.fillRect(0, 0, W, H)

    // ±45° 가이드라인
    ctx2d.strokeStyle = C.GRID
    ctx2d.lineWidth   = 1
    ;[[-1, 1] as const, [1, 1] as const].forEach(([sx, sy]) => {
      ctx2d.beginPath()
      ctx2d.moveTo(cx, cy)
      ctx2d.lineTo(cx + sx * r, cy - sy * r)
      ctx2d.stroke()
    })

    // 중심 십자선
    ctx2d.strokeStyle = C.CROSS
    ctx2d.lineWidth   = 1
    ctx2d.beginPath()
    ctx2d.moveTo(cx - r, cy); ctx2d.lineTo(cx + r, cy)
    ctx2d.moveTo(cx, cy - r); ctx2d.lineTo(cx, cy + r)
    ctx2d.stroke()

    // 레이블
    ctx2d.fillStyle  = C.LABEL
    ctx2d.font       = '9px JetBrains Mono, monospace'
    ctx2d.textAlign  = 'center'
    ctx2d.fillText('L', cx - r + 10, cy - 6)
    ctx2d.fillText('R', cx + r - 10, cy - 6)
    ctx2d.fillText('M', cx, cy - r + 14)
    ctx2d.fillText('S', cx, cy + r - 4)
    ctx2d.textAlign = 'left'
  }, [])

  // ── AudioContext + ScriptProcessor ──────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return

    if (!stream) {
      ctx2d.clearRect(0, 0, width, height)
      drawStatic(ctx2d, width, height)
      return
    }

    const AudioCtx = window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const audioCtx = new AudioCtx()
    ctxRef.current = audioCtx

    let cancelled     = false
    let correlation   = 0
    let hasNewSamples = false  // dirty flag: 새 오디오 프레임 도착 여부

    const doSetup = () => {
      if (cancelled || audioCtx.state === 'closed') return

      const source = audioCtx.createMediaStreamSource(stream)
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const processor = audioCtx.createScriptProcessor(2048, 2, 2)
      processorRef.current = processor

      const silencer = audioCtx.createGain()
      silencer.gain.value = 0

      // ✅ onaudioprocess: 연산 + 저장만 — 캔버스 조작 전혀 없음
      processor.onaudioprocess = (ev) => {
        const inputL = ev.inputBuffer.getChannelData(0)
        const inputR = ev.inputBuffer.numberOfChannels > 1
          ? ev.inputBuffer.getChannelData(1)
          : inputL

        // 상관계수 계산 (경량 연산)
        let sumLR = 0, sumL2 = 0, sumR2 = 0
        for (let i = 0; i < inputL.length; i++) {
          sumLR += inputL[i]! * inputR[i]!
          sumL2 += inputL[i]! * inputL[i]!
          sumR2 += inputR[i]! * inputR[i]!
        }
        const denom = Math.sqrt(sumL2 * sumR2)
        correlation = denom > 1e-10
          ? Math.max(-1, Math.min(1, sumLR / denom))
          : 0

        // 샘플 복사 저장 → rAF tick에서 드로잉
        samplesRef.current = {
          L: Float32Array.from(inputL),
          R: Float32Array.from(inputR),
        }
        hasNewSamples = true
      }

      // source → processor → silencer(gain=0) → destination
      source.connect(processor)
      processor.connect(silencer)
      silencer.connect(audioCtx.destination)
    }

    // ✅ resume() 완료 후 setup — suspended 컨텍스트에서 onaudioprocess 미발화 방지
    if (audioCtx.state === 'running') {
      doSetup()
    } else {
      audioCtx.resume().then(doSetup).catch(doSetup)
    }

    // ── rAF 렌더링 루프 (모든 캔버스 조작 여기서만) ─────────────────────────
    const tick = () => {
      if (cancelled) return  // ← 좀비 루프 방지: cleanup 후 대기 중 rAF 차단

      // 새 오디오 프레임이 있을 때만 ghost + dots 그리기 (잔상 속도 = 오디오 콜백 속도)
      if (hasNewSamples && samplesRef.current) {
        hasNewSamples = false
        const { L, R } = samplesRef.current

        // 잔상 페이드 오버레이
        ctx2d.fillStyle = C.GHOST
        ctx2d.fillRect(0, 0, width, height)
        drawStatic(ctx2d, width, height)

        // 점 색상 (상관계수 기반)
        const dotColor = correlation < -0.5 ? C.DANGER
          : correlation < 0.3              ? C.CAUTION
          :                                  C.OK

        ctx2d.fillStyle   = dotColor
        ctx2d.globalAlpha = 0.85

        const cx  = width  / 2
        const cy  = height / 2
        const scl = Math.min(width, height) * 0.44

        // 4샘플 건너뛰기: 2048 → 512 점 (퍼포먼스 균형)
        for (let i = 0; i < L.length; i += 4) {
          const Lv = L[i]!
          const Rv = R[i]!
          const mx = (Lv + Rv) / SQRT2
          const sy = (Lv - Rv) / SQRT2
          ctx2d.fillRect(cx + mx * scl, cy - sy * scl, 1.5, 1.5)
        }
        ctx2d.globalAlpha = 1
      }

      // danger 테두리: 항상 최신 상관계수 반영 (60fps)
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
      try { processorRef.current?.disconnect() } catch {}
      void audioCtx.close()
      ctxRef.current       = null
      processorRef.current = null
      samplesRef.current   = null
    }
  }, [stream, width, height, drawStatic])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        width:        width,
        height:       height,
        display:      'block',
        borderRadius: 8,
        border:       `1px solid ${C.BORDER}`,
        background:   C.BG,
      }}
    />
  )
}

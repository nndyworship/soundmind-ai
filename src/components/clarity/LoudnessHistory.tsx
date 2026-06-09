/**
 * LoudnessHistory.tsx — LUFS 스크롤링 히스토그램
 *
 * 오른쪽→왼쪽 스크롤 캔버스
 * - M (Momentary) : #00c853 녹색
 * - S (Short-term): #0a84ff 파랑
 * - I (Integrated) : 흰색 수평선
 * - 타깃 라인: #ffd600 노랑 점선
 * - 타깃 ±1LU 구간: 반투명 초록 배경
 * - 초과 구간 (> target + 3LU): 반투명 빨강 배경
 *
 * ⚠ Canvas API는 CSS var() 미지원 — 모든 색상을 하드코딩
 * 비용: $0 (Canvas 2D)
 */

import { useRef, useEffect, useCallback } from 'react'
import type { LoudnessMetrics } from '../../hooks/useLoudnessMeter'

// Canvas API는 CSS var() 지원 안 함 → 하드코딩
const C = {
  BG:         '#0d0d10',
  BORDER:     '#2a2a30',
  OK:         '#00c853',
  CAUTION:    '#ffd600',
  DANGER:     '#ff1744',
  BLUE:       '#0a84ff',
  OK_08:      'rgba(0,200,83,0.08)',
  DANGER_06:  'rgba(255,23,68,0.06)',
  GRID:       'rgba(255,255,255,0.04)',
  LABEL:      'rgba(255,255,255,0.18)',
  WHITE_70:   'rgba(255,255,255,0.7)',
  WHITE_60:   'rgba(255,255,255,0.6)',
} as const

interface LoudnessHistoryProps {
  metrics:          LoudnessMetrics
  target:           number
  durationSeconds?: number          // 현재 미사용 (향후 축 표시용)
  width?:           number
  height?:          number
}

const DB_MIN = -36
const DB_MAX =   0

export default function LoudnessHistory({
  metrics,
  target,
  durationSeconds: _durationSeconds = 60,
  width   = 560,
  height  = 160,
}: LoudnessHistoryProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const histMRef  = useRef<number[]>([])
  const histSRef  = useRef<number[]>([])

  const dbToY = useCallback((db: number): number => {
    const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db))
    return height - ((clamped - DB_MIN) / (DB_MAX - DB_MIN)) * height
  }, [height])

  // 샘플 추가
  useEffect(() => {
    histMRef.current.push(metrics.M)
    histSRef.current.push(metrics.S)
    if (histMRef.current.length > width) {
      histMRef.current.shift()
      histSRef.current.shift()
    }
  }, [metrics.M, metrics.S, width])

  // Canvas 렌더링
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, width, height)

    // 배경
    ctx.fillStyle = C.BG
    ctx.fillRect(0, 0, width, height)

    // 타깃 ±1LU 구간 (초록 배경)
    const yTargetTop = dbToY(target + 1)
    const yTargetBot = dbToY(target - 1)
    ctx.fillStyle = C.OK_08
    ctx.fillRect(0, yTargetTop, width, yTargetBot - yTargetTop)

    // 초과 구간 (target+3 이상 → 빨강 배경)
    const yDangerBot = dbToY(target + 3)
    ctx.fillStyle = C.DANGER_06
    ctx.fillRect(0, 0, width, yDangerBot)

    // dB 그리드
    ctx.strokeStyle = C.GRID
    ctx.lineWidth   = 1
    ;[-6, -12, -18, -24, -30].forEach(db => {
      const y = dbToY(db)
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
      ctx.fillStyle = C.LABEL
      ctx.font      = '8px JetBrains Mono, monospace'
      ctx.fillText(`${db}`, 2, y - 2)
    })

    // 타깃 라인 (점선)
    const yTarget = dbToY(target)
    ctx.strokeStyle = C.CAUTION
    ctx.lineWidth   = 1
    ctx.setLineDash([6, 4])
    ctx.beginPath(); ctx.moveTo(0, yTarget); ctx.lineTo(width, yTarget); ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = C.CAUTION
    ctx.font      = '8px JetBrains Mono, monospace'
    ctx.fillText(`TARGET ${target} LUFS`, width - 110, yTarget - 3)

    // M / S 라인 그리기
    const histM  = histMRef.current
    const histS  = histSRef.current
    const offset = width - histM.length

    const drawLine = (hist: number[], color: string, alpha: number) => {
      ctx.strokeStyle = color
      ctx.globalAlpha = alpha
      ctx.lineWidth   = 1.5
      ctx.beginPath()
      let moved = false
      for (let i = 0; i < hist.length; i++) {
        const v = hist[i]!
        if (!isFinite(v)) continue
        const x = offset + i
        const y = dbToY(v)
        if (!moved) { ctx.moveTo(x, y); moved = true }
        else          ctx.lineTo(x, y)
      }
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    drawLine(histM, C.OK,   0.8)
    drawLine(histS, C.BLUE, 0.6)

    // I (Integrated) 수평선
    if (isFinite(metrics.I)) {
      const yI = dbToY(metrics.I)
      ctx.strokeStyle = C.WHITE_70
      ctx.lineWidth   = 1
      ctx.setLineDash([3, 6])
      ctx.beginPath(); ctx.moveTo(0, yI); ctx.lineTo(width, yI); ctx.stroke()
      ctx.setLineDash([])
      ctx.fillStyle = C.WHITE_60
      ctx.font      = '8px JetBrains Mono, monospace'
      ctx.fillText(`I ${metrics.I.toFixed(1)}`, 4, yI - 3)
    }

    // 레전드
    ctx.font = '8px JetBrains Mono, monospace'
    ;[
      { label: '— M',  color: C.OK,              x: 4  },
      { label: '— S',  color: C.BLUE,             x: 32 },
      { label: '-- I', color: 'rgba(255,255,255,0.5)', x: 60 },
    ].forEach(({ label, color, x }) => {
      ctx.fillStyle = color
      ctx.fillText(label, x, height - 4)
    })
  }, [metrics, target, width, height, dbToY])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        display:      'block',
        width:        width,
        height:       height,
        borderRadius: 6,
        border:       `1px solid ${C.BORDER}`,
      }}
    />
  )
}

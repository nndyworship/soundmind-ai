/**
 * LevelMeter.tsx — 스테레오 수직 세그먼트 레벨 미터
 *
 * ✅ 연속 rAF 애니메이션 루프 적용
 *    - tpL/tpR는 ref로 유지 → rAF 클로저에서 항상 최신값 참조
 *    - 피크 홀드: 3s 유지 → 시간 기반 낙하 (8dB/s @ 60fps)
 *    - 오디오 프레임 사이 60fps 애니메이션 → 부드러운 홀드 낙하
 *
 * ⚠ Canvas API는 CSS var() 미지원 — 모든 색상 하드코딩
 *
 * - 60세그먼트 (-60 ~ 0 dBTP)
 * - 색상 구간: ok(-60~-18) / caution(-18~-6) / danger(-6~0)
 *
 * 비용: $0 (Canvas 2D)
 */

import { useRef, useEffect } from 'react'

// Canvas API는 CSS var() 지원 안 함 → 하드코딩
const C = {
  BG:      '#0d0d10',
  OK:      '#00c853',
  CAUTION: '#ffd600',
  DANGER:  '#ff1744',
  DIM:     'rgba(255,255,255,0.07)',
  HOLD:    '#ffffff',
  LABEL:   'rgba(255,255,255,0.45)',
  NUM_OK:  'rgba(255,255,255,0.6)',
} as const

interface LevelMeterProps {
  tpL:       number
  tpR:       number
  peakHold?: boolean
}

const SEGMENTS  = 60
const DB_MIN    = -60
const DB_MAX    = 0
const SEG_H     = 6
const SEG_GAP   = 1
const METER_W   = 22
const HOLD_MS   = 3000
// 시간 기반 낙하 속도 (dB/ms) — 3초 홀드 후 약 3.5초에 걸쳐 바닥 도달
const FALL_RATE = 0.008  // 8 dB/s

function dbToSeg(db: number): number {
  const c = Math.max(DB_MIN, Math.min(DB_MAX, db))
  return Math.floor(((c - DB_MIN) / (DB_MAX - DB_MIN)) * SEGMENTS)
}

function segToDb(seg: number): number {
  return DB_MIN + (seg / SEGMENTS) * (DB_MAX - DB_MIN)
}

function segColor(seg: number): string {
  const db = segToDb(seg)
  if (db >= -6)  return C.DANGER
  if (db >= -18) return C.CAUTION
  return C.OK
}

export default function LevelMeter({ tpL, tpR, peakHold = true }: LevelMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const holdLRef  = useRef<{ db: number; ts: number } | null>(null)
  const holdRRef  = useRef<{ db: number; ts: number } | null>(null)
  const rafRef    = useRef<number>(0)
  // Props를 ref로 유지 — rAF 클로저에서 항상 최신값 참조 (stale closure 방지)
  const tpLRef    = useRef(tpL)
  const tpRRef    = useRef(tpR)

  // 매 렌더마다 ref 동기화 (useEffect 없이 바로 대입 — 렌더 중 동기 실행)
  tpLRef.current = tpL
  tpRRef.current = tpR

  const totalH = SEGMENTS * (SEG_H + SEG_GAP) + 20
  const totalW = METER_W * 2 + 8 + 32

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // ── 연속 rAF 드로잉 루프 ───────────────────────────────────────────────
    const draw = () => {
      const now  = performance.now()
      const curL = tpLRef.current
      const curR = tpRRef.current

      // 피크 홀드 갱신
      if (peakHold) {
        // 홀드 업데이트 (신호 있을 때만 갱신 — 신호 소멸 시 자연 낙하)
        if (isFinite(curL)) {
          if (!holdLRef.current || curL > holdLRef.current.db) {
            holdLRef.current = { db: curL, ts: now }
          }
        }
        if (isFinite(curR)) {
          if (!holdRRef.current || curR > holdRRef.current.db) {
            holdRRef.current = { db: curR, ts: now }
          }
        }

        // 시간 기반 낙하 (HOLD_MS 경과 후 FALL_RATE dB/ms)
        for (const holdRef of [holdLRef, holdRRef]) {
          if (holdRef.current && now - holdRef.current.ts > HOLD_MS) {
            holdRef.current.db -= FALL_RATE * 16  // 16ms ≈ 1 rAF frame
            if (holdRef.current.db < DB_MIN) holdRef.current = null
          }
        }
      }

      // ── 렌더링 ─────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, totalW, totalH)
      ctx.fillStyle = C.BG
      ctx.fillRect(0, 0, totalW, totalH)

      const drawChannel = (
        xOff:   number,
        db:     number,
        holdDb: number | null,
      ) => {
        const activeSeg = isFinite(db) ? dbToSeg(db) : 0

        for (let s = 0; s < SEGMENTS; s++) {
          const y    = totalH - 20 - (s + 1) * (SEG_H + SEG_GAP)
          const lit  = s < activeSeg
          const hold = holdDb !== null && Math.abs(s - dbToSeg(holdDb)) === 0

          ctx.fillStyle = hold ? C.HOLD : lit ? segColor(s) : C.DIM
          ctx.fillRect(xOff, y, METER_W, SEG_H)
        }
      }

      drawChannel(0,           curL, holdLRef.current?.db ?? null)
      drawChannel(METER_W + 8, curR, holdRRef.current?.db ?? null)

      // dB 레이블
      ctx.fillStyle = C.LABEL
      ctx.font      = '10px JetBrains Mono, monospace'
      ;[-6, -18, -36, -60].forEach(db => {
        const seg = dbToSeg(db)
        const y   = totalH - 20 - seg * (SEG_H + SEG_GAP)
        ctx.fillText(`${db}`, METER_W * 2 + 10, y + 4)
      })

      // 수치
      ctx.font      = 'bold 10px JetBrains Mono, monospace'
      ctx.textAlign = 'center'
      ctx.fillStyle = isFinite(curL) && curL > -6 ? C.DANGER : C.NUM_OK
      ctx.fillText(isFinite(curL) ? curL.toFixed(1) : '-∞', METER_W / 2, totalH - 4)
      ctx.fillStyle = isFinite(curR) && curR > -6 ? C.DANGER : C.NUM_OK
      ctx.fillText(isFinite(curR) ? curR.toFixed(1) : '-∞', METER_W + 8 + METER_W / 2, totalH - 4)
      ctx.textAlign = 'left'

      rafRef.current = requestAnimationFrame(draw)
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafRef.current)

  // tpL/tpR는 의존성에서 제외 — ref로 관리하므로 루프 재시작 불필요
  // peakHold/totalH/totalW 변경 시에만 루프 재초기화
  }, [totalH, totalW, peakHold])

  return (
    <canvas
      ref={canvasRef}
      width={totalW}
      height={totalH}
      style={{
        width:    totalW,
        height:   totalH,
        display:  'block',
        imageRendering: 'pixelated',
      }}
    />
  )
}

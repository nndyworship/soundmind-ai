import { useRef, useCallback, useEffect, useState } from 'react'

interface Props {
  value: number          // dB (-∞ ~ +10)
  onChange: (db: number) => void
  color?: string
  label?: string
  height?: number
}

const FADER_H  = 280   // 트랙 높이 px
const THUMB_H  = 28    // 썸 높이 px
const FADER_W  = 48    // 전체 폭 px
const DB_MAX   = 10
const DB_MIN   = -60   // 실용 최솟값 (-∞ 표시)

// dB → 픽셀 (로그 스케일 : 0dB가 트랙 하단 1/3 지점)
function dbToY(db: number, trackH: number): number {
  const ratio = (db - DB_MAX) / (DB_MIN - DB_MAX)
  return Math.max(0, Math.min(ratio * trackH, trackH - THUMB_H))
}

// VU 미터 레벨 색상
function vuColor(db: number): string {
  if (db > -3)  return '#ff3b30'
  if (db > -12) return '#ffb300'
  return '#00ff88'
}

export default function FaderSlider({ value, onChange, color = '#00ff88', label = '', height = FADER_H }: Props) {
  const trackRef   = useRef<HTMLDivElement>(null)
  const dragging   = useRef(false)
  const startY     = useRef(0)
  const startDb    = useRef(0)
  const [vu, setVu] = useState(value)

  // VU 미터: 값 변경 시 시각화
  useEffect(() => { setVu(value) }, [value])

  const clamp = (db: number) => Math.max(DB_MIN, Math.min(DB_MAX, db))

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    startY.current   = e.clientY
    startDb.current  = value
  }, [value])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current || !trackRef.current) return
    const trackH   = height - THUMB_H
    const dyPx     = e.clientY - startY.current
    const dyDb     = (dyPx / trackH) * (DB_MIN - DB_MAX)
    const newDb    = clamp(startDb.current - dyDb)
    onChange(Math.abs(newDb) < 0.4 ? 0 : Math.round(newDb * 2) / 2)
  }, [height, onChange])

  const onPointerUp = useCallback(() => { dragging.current = false }, [])

  // 더블클릭: 0dB (Unity) 리셋
  const onDoubleClick = useCallback(() => onChange(0), [onChange])

  const trackH  = height
  const thumbY  = dbToY(value, trackH)
  const dbLabel = value <= DB_MIN ? '-∞' : `${value > 0 ? '+' : ''}${value.toFixed(1)}`

  // VU 미터 세그먼트 수
  const SEG = 20
  const dbPerSeg = (DB_MAX - DB_MIN) / SEG

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                  userSelect: 'none', WebkitUserSelect: 'none' }}>

      {/* dB 수치 */}
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700,
                    color, minWidth: 48, textAlign: 'center' }}>
        {dbLabel} dB
      </div>

      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>

        {/* VU 미터 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: THUMB_H / 2 }}>
          {Array.from({ length: SEG }, (_, i) => {
            const segDb = DB_MAX - i * dbPerSeg
            const lit   = segDb <= vu
            return (
              <div key={i} style={{
                width: 6, height: Math.floor((height - THUMB_H) / SEG) - 2,
                borderRadius: 1,
                background: lit ? vuColor(segDb) : '#111',
                transition: 'background 80ms',
              }} />
            )
          })}
        </div>

        {/* 페이더 트랙 */}
        <div
          ref={trackRef}
          style={{
            width: FADER_W,
            height: trackH,
            position: 'relative',
            cursor: 'ns-resize',
            touchAction: 'none',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          {/* 트랙 배경 */}
          <div style={{
            position: 'absolute',
            left: '50%', transform: 'translateX(-50%)',
            top: THUMB_H / 2, bottom: THUMB_H / 2,
            width: 6, borderRadius: 3,
            background: 'linear-gradient(to bottom, #2a2a2a, #0a0a0a)',
            boxShadow: 'inset 0 1px 3px #000',
          }} />

          {/* 0dB 노치 마커 */}
          <div style={{
            position: 'absolute',
            left: '50%', transform: 'translateX(-50%)',
            top: dbToY(0, trackH) + THUMB_H / 2 - 1,
            width: 20, height: 2,
            background: '#333',
          }} />

          {/* dB 눈금 레이블 */}
          {[10, 6, 3, 0, -6, -12, -20, -40].map(db => (
            <div key={db} style={{
              position: 'absolute',
              right: FADER_W + 4,
              top: dbToY(db, trackH) + THUMB_H / 2 - 6,
              fontSize: 9, fontFamily: 'monospace', color: db === 0 ? '#555' : '#2a2a2a',
              whiteSpace: 'nowrap', pointerEvents: 'none',
            }}>
              {db > 0 ? '+' : ''}{db}
            </div>
          ))}

          {/* 썸(Fader Thumb) — 아날로그 믹서 감성 */}
          <div style={{
            position: 'absolute',
            left: 0, right: 0,
            top: thumbY,
            height: THUMB_H,
            background: `linear-gradient(180deg, #3a3a3a 0%, #222 50%, #1a1a1a 100%)`,
            border: `1px solid ${value === 0 ? color : '#444'}`,
            borderRadius: 4,
            boxShadow: `0 2px 8px #000, 0 0 0 1px #000, inset 0 1px 0 #555`,
            cursor: 'grab',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {/* 썸 그립 라인 */}
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: 24, height: 1, borderRadius: 1,
                background: i === 1 ? color + '88' : '#444',
                position: 'absolute',
                top: 10 + i * 5,
              }} />
            ))}
          </div>
        </div>
      </div>

      {/* 레이블 */}
      {label && (
        <div style={{ fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
                      color: '#555', letterSpacing: 1, textAlign: 'center', maxWidth: 60 }}>
          {label}
        </div>
      )}
    </div>
  )
}

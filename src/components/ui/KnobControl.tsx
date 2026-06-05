import { useRef, useCallback } from 'react'

interface Props {
  value: number         // 0.0 ~ 1.0 (정규화)
  onChange: (v: number) => void
  label: string
  displayValue: string  // 표시 문자열 (ex: "4:1", "25ms")
  color?: string
  size?: number
}

const START_ANGLE = -135  // 7시 방향 (도)
const END_ANGLE   =  135  // 5시 방향 (도)
const RANGE_ANGLE = END_ANGLE - START_ANGLE  // 270도

export default function KnobControl({ value, onChange, label, displayValue, color = '#00ff88', size = 64 }: Props) {
  const dragging  = useRef(false)
  const startY    = useRef(0)
  const startVal  = useRef(0)

  const angle = START_ANGLE + value * RANGE_ANGLE
  const rad   = (angle * Math.PI) / 180
  const cx    = size / 2
  const r     = size / 2 - 4

  // 인디케이터 라인 끝점
  const indX  = cx + (r - 6) * Math.sin(rad)
  const indY  = cx - (r - 6) * Math.cos(rad)

  // SVG 호 (배경 + 값)
  function arcPath(from: number, to: number, radius: number) {
    const toRad = (d: number) => ((d - 90) * Math.PI) / 180
    const x1 = cx + radius * Math.cos(toRad(from))
    const y1 = cx + radius * Math.sin(toRad(from))
    const x2 = cx + radius * Math.cos(toRad(to))
    const y2 = cx + radius * Math.sin(toRad(to))
    const large = to - from > 180 ? 1 : 0
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`
  }

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
    startY.current   = e.clientY
    startVal.current = value
  }, [value])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return
    const dy    = startY.current - e.clientY   // 위로 드래그 = 값 증가
    const delta = dy / 200
    onChange(Math.max(0, Math.min(1, startVal.current + delta)))
  }, [onChange])

  const onPointerUp = useCallback(() => { dragging.current = false }, [])

  // 더블클릭: 중앙값 리셋
  const onDoubleClick = useCallback(() => onChange(0.5), [onChange])

  const trackAngle = START_ANGLE + 90   // SVG 좌표계 오프셋
  const valueAngle = trackAngle + value * RANGE_ANGLE

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  userSelect: 'none', WebkitUserSelect: 'none' }}>
      <svg
        width={size} height={size}
        style={{ cursor: 'ns-resize', touchAction: 'none', overflow: 'visible' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        {/* 배경 호 (전체 범위) */}
        <path
          d={arcPath(START_ANGLE + 90, END_ANGLE + 90, r - 2)}
          fill="none" stroke="#1a1a1a" strokeWidth={4} strokeLinecap="round"
        />
        {/* 값 호 (현재 위치까지) */}
        {value > 0.02 && (
          <path
            d={arcPath(START_ANGLE + 90, valueAngle, r - 2)}
            fill="none" stroke={color} strokeWidth={4} strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 3px ${color}66)` }}
          />
        )}
        {/* 노브 바디 */}
        <circle cx={cx} cy={cx} r={r - 8}
          fill="url(#knobGrad)" stroke="#333" strokeWidth={1}
        />
        <defs>
          <radialGradient id="knobGrad" cx="40%" cy="35%">
            <stop offset="0%"   stopColor="#3a3a3a" />
            <stop offset="100%" stopColor="#141414" />
          </radialGradient>
        </defs>
        {/* 인디케이터 라인 */}
        <line
          x1={cx} y1={cx}
          x2={indX} y2={indY}
          stroke={color} strokeWidth={2} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 2px ${color})` }}
        />
        {/* 센터 도트 */}
        <circle cx={cx} cy={cx} r={2} fill={color + '88'} />
      </svg>

      {/* 값 표시 */}
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12,
                    fontWeight: 700, color, textAlign: 'center', minWidth: size }}>
        {displayValue}
      </div>
      {/* 레이블 */}
      <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#444',
                    letterSpacing: 1, textAlign: 'center', maxWidth: size }}>
        {label}
      </div>
    </div>
  )
}

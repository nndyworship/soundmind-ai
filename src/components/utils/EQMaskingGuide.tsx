import { useState, useRef, useEffect, useMemo } from 'react'
import eqData from '../../data/eqMaskingMap.json'
import fmData  from '../../data/fletcherMunson.json'

type SpaceType = 'church' | 'concert'

interface EQBand {
  freq: number
  Q: number
  dB: number
  type: string
  band: string
  reason: string
}

interface Instrument {
  id: string
  name: string
  color: string
  freqRanges: Record<string, [number, number]>
  eqGuide: Record<SpaceType, EQBand[]>
  maskingConflicts: string[]
}

const instruments = eqData.instruments as unknown as Instrument[]
const LOG_MIN = Math.log10(20)
const LOG_MAX = Math.log10(20000)

function freqToX(freq: number, w: number) {
  return ((Math.log10(Math.max(freq, 20)) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * w
}

// 캔버스 스펙트럼 맵 렌더링
function drawSpectrumMap(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  selected: string[],
  space: SpaceType
) {
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  // 주파수 그리드
  const gridFreqs = [50, 100, 200, 500, 1000, 2000, 5000, 10000]
  ctx.strokeStyle = '#1a1a1a'
  ctx.lineWidth = 1
  ctx.font = '10px JetBrains Mono, monospace'
  ctx.fillStyle = '#333'
  gridFreqs.forEach(f => {
    const x = freqToX(f, W)
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H - 20); ctx.stroke()
    ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x - 8, H - 6)
  })

  const instrMap = Object.fromEntries(instruments.map(i => [i.id, i]))

  selected.forEach(id => {
    const instr = instrMap[id]
    if (!instr) return
    const col = instr.color

    // 주파수 범위 영역 표시
    Object.values(instr.freqRanges).forEach(([lo, hi]) => {
      if (typeof lo !== 'number' || typeof hi !== 'number') return
      const x1 = freqToX(lo, W)
      const x2 = freqToX(hi, W)
      ctx.fillStyle = col + '28'
      ctx.fillRect(x1, 0, x2 - x1, H - 20)
    })

    // EQ 포인트 마커
    const guide = instr.eqGuide[space]
    guide.forEach(band => {
      if (band.type === 'HPF') return
      const x = freqToX(band.freq, W)
      const isBoost = band.dB > 0
      ctx.strokeStyle = col
      ctx.lineWidth = 2
      ctx.fillStyle = col
      ctx.beginPath()
      ctx.arc(x, isBoost ? 18 : H - 38, 5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = col
      ctx.font = 'bold 9px monospace'
      ctx.fillText(`${isBoost ? '+' : ''}${band.dB}`, x - 6, isBoost ? 10 : H - 42)
    })
  })

  // 충돌 구간 강조 (선택된 악기 중 마스킹 쌍)
  eqData.maskingPairs.forEach(mp => {
    const [a, b] = mp.pair
    if (selected.includes(a) && selected.includes(b)) {
      mp.conflictZones.forEach(zone => {
        const [lo, hi] = zone as [number, number]
        const x1 = freqToX(lo, W)
        const x2 = freqToX(hi, W)
        ctx.fillStyle = '#ff3b3022'
        ctx.fillRect(x1, 0, x2 - x1, H - 20)
        ctx.strokeStyle = '#ff3b3066'
        ctx.lineWidth = 1
        ctx.setLineDash([4, 3])
        ctx.strokeRect(x1, 0, x2 - x1, H - 20)
        ctx.setLineDash([])
      })
    }
  })
}

// 등청감 곡선 캔버스
function drawLoudnessCurve(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  space: SpaceType
) {
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H)

  const phon = space === 'church' ? 75 : 90
  const curveKey = phon >= 90 ? '100phon' : phon >= 75 ? '80phon' : '60phon'
  const curve = fmData.curves[curveKey as keyof typeof fmData.curves]
  const freqs = fmData.freqs
  const refVal = curve[17] ?? 0 // 1kHz 기준

  // y축 범위: -20 ~ +30 (상대값)
  const DB_LO = -20, DB_HI = 30
  const dbToY = (db: number) => H - 20 - ((db - DB_LO) / (DB_HI - DB_LO)) * (H - 30)
  const plotW = W - 40

  // 기준선 (0dB = 1kHz)
  ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 1
  const y0 = dbToY(0)
  ctx.beginPath(); ctx.moveTo(40, y0); ctx.lineTo(W, y0); ctx.stroke()
  ctx.fillStyle = '#333'; ctx.font = '9px monospace'
  ctx.fillText('0dB (1kHz기준)', 42, y0 - 3)

  // 등청감 곡선
  ctx.strokeStyle = space === 'church' ? '#0a84ff' : '#ffb300'
  ctx.lineWidth = 2
  ctx.beginPath()
  freqs.forEach((f, i) => {
    if (f < 20 || f > 20000) return
    const relDb = (curve[i] ?? 0) - refVal
    const x = freqToX(f, plotW) + 40
    const y = dbToY(relDb)
    if (i === 0 || f < 25) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()

  // 레이블
  ctx.fillStyle = space === 'church' ? '#0a84ff' : '#ffb300'
  ctx.font = 'bold 10px monospace'
  ctx.fillText(`${phon} phon (${space === 'church' ? '교회' : '콘서트'})`, 44, 14)

  // x축 레이블
  ctx.fillStyle = '#333'; ctx.font = '9px monospace'
  ;[50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach(f => {
    const x = freqToX(f, plotW) + 40
    ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x - 6, H - 4)
  })
}

// EQ 값 표시 행
function EQRow({ band, color }: { band: EQBand; color: string }) {
  const isHPF   = band.type === 'HPF'
  const isBoost = band.dB > 0
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '90px 60px 60px 60px 1fr',
                  gap: 8, padding: '8px 12px', borderBottom: '1px solid #111',
                  alignItems: 'center' }}>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13,
                    fontWeight: 700, color }}>
        {band.freq >= 1000 ? `${(band.freq / 1000).toFixed(band.freq >= 10000 ? 0 : 1)}kHz` : `${band.freq}Hz`}
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 12,
                    color: isHPF ? '#ffb300' : isBoost ? '#00ff88' : '#ff3b30', fontWeight: 700 }}>
        {isHPF ? 'HPF' : `${isBoost ? '+' : ''}${band.dB}dB`}
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 12, color: '#8a8a8a' }}>
        {isHPF ? '12~18dB/oct' : `Q=${band.Q.toFixed(1)}`}
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#555',
                    background: '#0a0a0a', borderRadius: 4, padding: '2px 6px' }}>
        {band.band}
      </div>
      <div style={{ fontSize: 11, color: '#666', lineHeight: 1.4 }}>
        {band.reason}
      </div>
    </div>
  )
}

export default function EQMaskingGuide() {
  const [space, setSpace]         = useState<SpaceType>('church')
  const [selected, setSelected]   = useState<string[]>(['kick', 'bass', 'vocal'])
  const [activeInstr, setActive]  = useState<string>('vocal')
  const mapCanvasRef   = useRef<HTMLCanvasElement>(null)
  const curveCanvasRef = useRef<HTMLCanvasElement>(null)

  // 마스킹 충돌 쌍 계산
  const conflicts = useMemo(() =>
    eqData.maskingPairs.filter(mp =>
      mp.pair.every(id => selected.includes(id))
    ), [selected])

  // 스펙트럼 맵 렌더링
  useEffect(() => {
    const c = mapCanvasRef.current; if (!c) return
    const ctx = c.getContext('2d'); if (!ctx) return
    drawSpectrumMap(ctx, c.width, c.height, selected, space)
  }, [selected, space])

  // 등청감 곡선 렌더링
  useEffect(() => {
    const c = curveCanvasRef.current; if (!c) return
    const ctx = c.getContext('2d'); if (!ctx) return
    drawLoudnessCurve(ctx, c.width, c.height, space)
  }, [space])

  const toggleInstr = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    setActive(id)
  }

  const activeInstrData = instruments.find(i => i.id === activeInstr)
  const spaceProfile = eqData.spaceProfiles[space]
  const loudnessNote = space === 'church'
    ? '교회(75phon): 저역·고역이 실제보다 약하게 들림 → 저역 보상 필요'
    : '콘서트(90phon+): 저역이 과도하게 들림 → 과감한 저역 컷 필수'

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>

      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700,
                       letterSpacing: 2, color: '#ffb300' }}>
          EQ MASKING GUIDE
        </span>
        {/* 공간 선택 */}
        <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {(['church', 'concert'] as SpaceType[]).map(s => (
            <button key={s} onClick={() => setSpace(s)} style={{
              padding: '8px 20px', border: 'none', cursor: 'pointer', fontSize: 12,
              fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, letterSpacing: 1,
              background: space === s ? (s === 'church' ? '#0a84ff22' : '#ffb30022') : 'transparent',
              color: space === s ? (s === 'church' ? '#0a84ff' : '#ffb300') : '#555',
              borderRight: s === 'church' ? '1px solid var(--border)' : 'none',
            }}>
              {s === 'church' ? '교회 예배' : '라이브 콘서트'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* 공간 프로파일 */}
        <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                      borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 8 }}>
            <StatBadge label="RT60" value={spaceProfile.RT60} />
            <StatBadge label="FOH SPL" value={spaceProfile.SPLAtFOH} />
          </div>
          <div style={{ fontSize: 11, color: '#0a84ff', fontFamily: 'monospace', marginBottom: 8 }}>
            등청감 보정 → {loudnessNote}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {spaceProfile.globalTips.map((tip, i) => (
              <div key={i} style={{ fontSize: 11, color: '#666', fontFamily: 'monospace' }}>
                • {tip}
              </div>
            ))}
          </div>
        </div>

        {/* 등청감 곡선 */}
        <div>
          <div style={{ fontSize: 11, letterSpacing: 1, color: 'var(--text-secondary)',
                        fontFamily: 'monospace', marginBottom: 8 }}>
            FLETCHER-MUNSON EQUAL-LOUDNESS (ISO 226:2003) — 현장 SPL 기준
          </div>
          <canvas ref={curveCanvasRef} width={800} height={120}
            style={{ width: '100%', height: 120, display: 'block', borderRadius: 6,
                     border: '1px solid var(--border)' }} />
        </div>

        {/* 악기 선택 */}
        <div>
          <div style={{ fontSize: 11, letterSpacing: 1, color: 'var(--text-secondary)',
                        fontFamily: 'monospace', marginBottom: 10 }}>
            믹스 악기 선택 (복수)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {instruments.map(instr => {
              const isSel = selected.includes(instr.id)
              const isAct = activeInstr === instr.id
              return (
                <button key={instr.id} onClick={() => toggleInstr(instr.id)} style={{
                  padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                  fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                  border: `2px solid ${isSel ? instr.color : '#1f1f1f'}`,
                  background: isSel ? instr.color + '22' : 'transparent',
                  color: isSel ? instr.color : '#555',
                  outline: isAct && isSel ? `1px solid ${instr.color}` : 'none',
                  outlineOffset: 2,
                }}>
                  {instr.name}
                </button>
              )
            })}
          </div>
        </div>

        {/* 스펙트럼 마스킹 맵 */}
        <div>
          <div style={{ fontSize: 11, letterSpacing: 1, color: 'var(--text-secondary)',
                        fontFamily: 'monospace', marginBottom: 8 }}>
            FREQUENCY MASKING MAP — 빨간 박스: 충돌 구간 / 원: EQ 포인트
          </div>
          <canvas ref={mapCanvasRef} width={800} height={130}
            style={{ width: '100%', height: 130, display: 'block', borderRadius: 6,
                     border: '1px solid var(--border)' }} />
          {/* 범례 */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
            {instruments.filter(i => selected.includes(i.id)).map(i => (
              <div key={i.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: i.color + '55',
                              border: `1px solid ${i.color}` }} />
                <span style={{ fontSize: 11, color: i.color, fontFamily: 'monospace' }}>{i.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 마스킹 충돌 경고 */}
        {conflicts.length > 0 && (
          <div style={{ background: '#1a0a00', border: '1px solid #ff3b3066',
                        borderRadius: 8, padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: '#ff3b30', fontFamily: 'monospace',
                          fontWeight: 700, marginBottom: 10, letterSpacing: 1 }}>
              마스킹 충돌 감지 ({conflicts.length}쌍)
            </div>
            {conflicts.map((mp, ci) => {
              const nameMap = Object.fromEntries(instruments.map(i => [i.id, i.name]))
              return (
                <div key={ci} style={{ marginBottom: ci < conflicts.length - 1 ? 16 : 0 }}>
                  <div style={{ fontSize: 12, color: '#ffb300', fontFamily: 'monospace', marginBottom: 6 }}>
                    {nameMap[mp.pair[0]]} ↔ {nameMap[mp.pair[1]]}
                  </div>
                  <div style={{ fontSize: 11, color: '#666', fontFamily: 'monospace',
                                marginBottom: 8, lineHeight: 1.5 }}>
                    {mp.resolution.principle}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {(mp.resolution[space] as Array<{instr: string; freq: number; Q: number; dB: number; type: string}>).map((r, ri) => {
                      const ic = instruments.find(i => i.id === r.instr)
                      return (
                        <div key={ri} style={{ fontFamily: 'JetBrains Mono, monospace',
                                               fontSize: 11, color: ic?.color ?? '#aaa' }}>
                          [{nameMap[r.instr]}] {r.freq >= 1000 ? `${r.freq/1000}kHz` : `${r.freq}Hz`}{' '}
                          {r.type === 'HPF' ? 'HPF' : `${r.dB > 0 ? '+' : ''}${r.dB}dB`}{' '}
                          {r.type !== 'HPF' && `Q=${r.Q.toFixed(1)}`}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* 악기별 EQ 상세 테이블 */}
        {selected.length > 0 && (
          <div>
            <div style={{ fontSize: 11, letterSpacing: 1, color: 'var(--text-secondary)',
                          fontFamily: 'monospace', marginBottom: 10 }}>
              악기별 EQ 상세 가이드 — {spaceProfile.name} 기준
            </div>
            {/* 악기 탭 */}
            <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', gap: 0 }}>
              {instruments.filter(i => selected.includes(i.id)).map(instr => (
                <button key={instr.id} onClick={() => setActive(instr.id)} style={{
                  padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: 11,
                  fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                  background: 'transparent',
                  color: activeInstr === instr.id ? instr.color : '#555',
                  borderBottom: activeInstr === instr.id ? `2px solid ${instr.color}` : '2px solid transparent',
                  marginBottom: -1,
                }}>
                  {instr.name}
                </button>
              ))}
            </div>

            {/* 테이블 헤더 */}
            {activeInstrData && (
              <div style={{ background: 'var(--bg-elevated)', borderRadius: '0 0 8px 8px',
                            border: '1px solid var(--border)', borderTop: 'none', overflow: 'hidden' }}>
                <div style={{ display: 'grid',
                              gridTemplateColumns: '90px 60px 60px 60px 1fr',
                              gap: 8, padding: '6px 12px', background: '#0a0a0a' }}>
                  {['주파수', '값', 'Q/기울기', '구간명', '이유'].map(h => (
                    <div key={h} style={{ fontSize: 10, color: '#444', fontFamily: 'monospace',
                                          letterSpacing: 1 }}>{h}</div>
                  ))}
                </div>
                {activeInstrData.eqGuide[space].map((band, i) => (
                  <EQRow key={i} band={band} color={activeInstrData.color} />
                ))}

                {/* 컴프레서 가이드 인라인 */}
                <div style={{ borderTop: '1px solid #1a1a1a', padding: '12px 16px',
                              background: '#050505' }}>
                  <div style={{ fontSize: 10, color: '#444', fontFamily: 'monospace',
                                letterSpacing: 1, marginBottom: 10 }}>
                    컴프레서 설정 (트랜지언트 지각 기반)
                  </div>
                  <CompGuideInline instr={activeInstrData} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function CompGuideInline({ instr }: { instr: Instrument }) {
  const cg = (instr as unknown as { compGuide: Record<string, unknown> }).compGuide as {
    ratio: string; attack: string; release: string; threshold: string;
    GR: string; transientNote: string; parallel: boolean; parallelRatio?: string
  }
  if (!cg) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {[
          { l: 'Ratio',     v: cg.ratio },
          { l: 'Attack',    v: cg.attack },
          { l: 'Release',   v: cg.release },
          { l: 'GR',        v: cg.GR },
        ].map(p => (
          <div key={p.l} style={{ background: '#0a0a0a', borderRadius: 6, padding: '8px 10px',
                                  border: '1px solid #1a1a1a' }}>
            <div style={{ fontSize: 9, color: '#444', fontFamily: 'monospace',
                          letterSpacing: 1, marginBottom: 4 }}>{p.l}</div>
            <div style={{ fontSize: 14, fontFamily: 'JetBrains Mono, monospace',
                          fontWeight: 700, color: instr.color }}>{p.v}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: '#666', fontFamily: 'monospace', lineHeight: 1.7,
                    background: '#08080a', borderRadius: 6, padding: '10px 12px',
                    border: '1px solid #1a1a1a' }}>
        <span style={{ color: instr.color, fontWeight: 700 }}>트랜지언트 지각: </span>
        {cg.transientNote}
      </div>
      {cg.parallel && (
        <div style={{ fontSize: 11, color: '#00ff88', fontFamily: 'monospace' }}>
          패러렐 컴프 권장: {cg.parallelRatio}
        </div>
      )}
    </div>
  )
}

function StatBadge({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: '#444', fontFamily: 'monospace', letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: 14, fontFamily: 'JetBrains Mono, monospace',
                    fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

import { useState, useRef } from 'react'
import { useAudioAnalyzer, type PeakInfo } from '../../hooks/useAudioAnalyzer'
import SpectrumDisplay from './SpectrumDisplay'

// ── 상수 ──────────────────────────────────────────────────────────────────────

const URGENCY_COLOR: Record<PeakInfo['urgency'], string> = {
  critical: 'var(--accent-red)',
  warning:  'var(--accent-amber)',
  info:     'var(--accent-blue)',
}

const URGENCY_LABEL: Record<PeakInfo['urgency'], string> = {
  critical: '위험',
  warning:  '주의',
  info:     '정보',
}

const URGENCY_BG: Record<PeakInfo['urgency'], string> = {
  critical: 'var(--accent-red-10)',
  warning:  'var(--accent-amber-10)',
  info:     'var(--accent-blue-10)',
}

interface LogEntry {
  time:     string
  freq:     number
  note:     string
  db:       number
  urgency:  PeakInfo['urgency']
  confirmed: boolean
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export default function HowlingDetector() {
  const {
    isActive, error, peaks, peak,
    spectrumData, dynamicThreshold,
    start, stop, sampleRate,
  } = useAudioAnalyzer()

  const [log, setLog]           = useState<LogEntry[]>([])
  const lastFreqRef             = useRef<number>(0)

  // 피크 감지 시 로그 추가 (최강 피크 기준, ±50Hz 이상 변화 시만)
  if (peak && Math.abs(peak.freq - lastFreqRef.current) > 50) {
    lastFreqRef.current = peak.freq
    setLog(prev => [{
      time:      new Date().toLocaleTimeString('ko-KR'),
      freq:      peak.freq,
      note:      peak.note,
      db:        peak.db,
      urgency:   peak.urgency,
      confirmed: peak.confirmed,
    }, ...prev].slice(0, 50))
  }

  const copyLog = () => {
    const text = log.map(e =>
      `[${e.time}] ${fmtHz(e.freq)} (${e.note}) ${e.db.toFixed(1)}dBFS${e.confirmed ? ' ★CONFIRMED' : ''}`
    ).join('\n')
    void navigator.clipboard.writeText(text)
  }

  return (
    <div style={{
      background:   'var(--bg-surface)',
      border:       '1px solid var(--border)',
      borderRadius: 12,
      overflow:     'hidden',
    }}>

      {/* 헤더 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '14px 20px', borderBottom: '1px solid var(--border)',
      }}>
        <span style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 13,
          fontWeight: 700, letterSpacing: 2, color: 'var(--accent-green)',
        }}>
          HOWLING DETECTOR
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {isActive && (
            <>
              {/* 동적 노이즈 플로어 표시 */}
              <span style={{
                fontSize: 10, color: 'var(--text-muted)',
                fontFamily: 'JetBrains Mono, monospace',
              }}>
                floor {dynamicThreshold.toFixed(1)}dB
              </span>
              <span style={{
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, color: 'var(--accent-red)', fontFamily: 'monospace',
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: 'var(--accent-red)',
                  animation: 'pulse 1s ease-in-out infinite',
                  display: 'inline-block',
                }} />
                LIVE
              </span>
            </>
          )}
        </div>
      </div>

      {/* 스펙트럼 (피크 전체 표시) */}
      <div style={{ background: '#000' }}>
        <SpectrumDisplay
          spectrumData={spectrumData}
          peakFreq={peak?.freq ?? null}
          sampleRate={sampleRate}
        />
      </div>

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* 에러 */}
        {error && (
          <div style={{
            background: 'var(--accent-red-10)', border: '1px solid var(--accent-red)',
            borderRadius: 8, padding: '12px 16px', color: 'var(--accent-red)',
            fontSize: 13, fontFamily: 'monospace',
          }}>
            {error}
          </div>
        )}

        {/* 다중 피크 목록 */}
        {peaks.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{
              fontSize: 10, letterSpacing: 1.5,
              color: 'var(--text-secondary)', fontFamily: 'JetBrains Mono, monospace',
              marginBottom: 2,
            }}>
              피크 감지 ({peaks.length}개) — 강도 순
            </div>

            {peaks.map((p, idx) => (
              <PeakCard key={idx} peak={p} rank={idx} />
            ))}
          </div>
        ) : isActive ? (
          <div style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 16, textAlign: 'center',
            color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 13,
          }}>
            하울링 없음 — 정상 상태 모니터링 중
          </div>
        ) : null}

        {/* 컨트롤 버튼 */}
        <div style={{ display: 'flex', gap: 12 }}>
          {!isActive ? (
            <button
              onClick={() => { void start() }}
              style={btnStyle('var(--accent-green)', 'var(--accent-green-10)')}
            >
              마이크 시작
            </button>
          ) : (
            <button
              onClick={stop}
              style={btnStyle('var(--accent-red)', 'var(--accent-red-10)')}
            >
              중지
            </button>
          )}
          <button
            onClick={copyLog}
            disabled={log.length === 0}
            style={{
              ...btnStyle('var(--accent-blue)', 'var(--accent-blue-10)'),
              opacity: log.length === 0 ? 0.4 : 1,
              cursor:  log.length === 0 ? 'default' : 'pointer',
            }}
          >
            로그 복사
          </button>
        </div>

        {/* 감지 로그 */}
        {log.length > 0 && (
          <div style={{
            background: '#000', border: '1px solid var(--border)',
            borderRadius: 8, padding: 12, maxHeight: 160, overflowY: 'auto',
          }}>
            <div style={{
              fontSize: 10, color: 'var(--text-secondary)',
              fontFamily: 'JetBrains Mono, monospace',
              marginBottom: 8, letterSpacing: 1,
            }}>
              감지 로그 (최근 {log.length}건)
            </div>
            {log.map((e, i) => (
              <div
                key={i}
                style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  fontSize: 11, lineHeight: 1.8,
                  color: 'var(--text-secondary)',
                }}
              >
                <span style={{ color: 'var(--text-muted)' }}>[{e.time}]</span>{' '}
                <span style={{ color: URGENCY_COLOR[e.urgency] }}>{fmtHz(e.freq)}</span>{' '}
                <span style={{ color: 'var(--accent-green)' }}>({e.note})</span>{' '}
                <span style={{ color: e.db > -20 ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
                  {e.db.toFixed(1)}dBFS
                </span>
                {e.confirmed && (
                  <span style={{ color: 'var(--accent-amber)', marginLeft: 6 }}>★</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0.3; }
        }
        @keyframes confirmedPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255,179,0,0.4); }
          50%       { box-shadow: 0 0 0 6px rgba(255,179,0,0); }
        }
      `}</style>
    </div>
  )
}

// ── PeakCard — 개별 피크 정보 카드 ───────────────────────────────────────────

function PeakCard({ peak, rank }: { peak: PeakInfo; rank: number }) {
  const color  = URGENCY_COLOR[peak.urgency]
  const bg     = URGENCY_BG[peak.urgency]

  return (
    <div style={{
      background:   bg,
      border:       `1px solid ${color}`,
      borderRadius: 8,
      padding:      '12px 14px',
      // 확정된 하울링이면 amber 글로우 애니메이션
      animation:    peak.confirmed ? 'confirmedPulse 1.2s ease-in-out infinite' : undefined,
      position:     'relative',
    }}>

      {/* 상단 헤더 행 */}
      <div style={{
        display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', marginBottom: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* 순위 배지 */}
          <span style={{
            width: 20, height: 20, borderRadius: '50%',
            background: rank === 0 ? color : 'var(--bg-elevated)',
            color:      rank === 0 ? '#000' : color,
            fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {rank + 1}
          </span>

          {/* 긴급도 레이블 */}
          <span style={{
            color, fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11, fontWeight: 700, letterSpacing: 1,
          }}>
            {URGENCY_LABEL[peak.urgency]}
          </span>

          {/* 확정 하울링 배지 */}
          {peak.confirmed && (
            <span style={{
              background: 'var(--accent-amber-20)',
              border:     '1px solid var(--accent-amber)',
              borderRadius: 4, padding: '1px 6px',
              fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
              color: 'var(--accent-amber)', fontWeight: 700, letterSpacing: 1,
            }}>
              ★ CONFIRMED HOWLING
            </span>
          )}
        </div>

        {/* 지속 프레임 수 */}
        <span style={{
          fontSize: 9, color: 'var(--text-muted)',
          fontFamily: 'JetBrains Mono, monospace',
        }}>
          {peak.persistenceFrames}f
        </span>
      </div>

      {/* 수치 그리드 */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
        gap: '8px 12px', marginBottom: 10,
      }}>
        <InfoCell label="주파수" value={fmtHz(peak.freq)} color={color} />
        <InfoCell label="강도"   value={`${peak.db.toFixed(1)} dBFS`} color={color} />
        <InfoCell label="음정"   value={peak.note} color="var(--text-primary)" />
        <InfoCell label="파장"   value={`${peak.wavelengthM.toFixed(3)} m`} color="var(--text-secondary)" />
        <InfoCell label="MIDI"   value={String(peak.midi)} color="var(--text-secondary)" />
        <InfoCell label="센트"   value={`${peak.cents > 0 ? '+' : ''}${peak.cents}¢`} color="var(--text-secondary)" />
      </div>

      {/* GEQ 대응 권고 */}
      <div style={{
        borderTop: `1px solid ${color}33`,
        paddingTop: 10,
        display:   'flex', flexDirection: 'column', gap: 4,
      }}>
        <div style={{
          fontSize: 9, letterSpacing: 1.5, color: 'var(--text-muted)',
          fontFamily: 'JetBrains Mono, monospace', marginBottom: 2,
        }}>
          GEQ 대응
        </div>

        {/* 1차 밴드 */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
            1차 밴드
          </span>
          <span style={{
            fontSize: 14, fontFamily: 'JetBrains Mono, monospace',
            fontWeight: 700, color,
          }}>
            {peak.geqBand}  {peak.cutDB}dB  Q{peak.Q.toFixed(1)}
          </span>
        </div>

        {/* 인접 밴드 */}
        {peak.adjacentBands.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
              인접 밴드도 확인
            </span>
            <span style={{
              fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
              color: 'var(--text-secondary)',
            }}>
              {peak.adjacentBands.join(' · ')}
            </span>
          </div>
        )}

        {/* 요약 텍스트 */}
        <div style={{
          marginTop: 4, fontSize: 11, color: 'var(--text-secondary)',
          fontFamily: 'monospace', lineHeight: 1.6,
        }}>
          31밴드 GEQ →{' '}
          <strong style={{ color }}>{peak.geqBand}</strong>을{' '}
          <strong style={{ color }}>{peak.cutDB}dB</strong> 컷{' '}
          (Q {peak.Q.toFixed(1)} — {peak.Q >= 4 ? '타이트 노치' : '광대역'})
          {peak.urgency === 'critical' && (
            <span style={{ color: 'var(--accent-red)' }}> — 즉각 조치 필요</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 서브 컴포넌트 ─────────────────────────────────────────────────────────────

function InfoCell({
  label, value, color,
}: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{
        fontSize: 9, color: 'var(--text-muted)',
        fontFamily: 'JetBrains Mono, monospace',
        letterSpacing: 1, marginBottom: 1,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 15, fontFamily: 'JetBrains Mono, monospace',
        fontWeight: 700, color,
      }}>
        {value}
      </div>
    </div>
  )
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function fmtHz(freq: number): string {
  return freq >= 1000
    ? `${(freq / 1000).toFixed(2)} kHz`
    : `${Math.round(freq)} Hz`
}

function btnStyle(fg: string, bg: string): React.CSSProperties {
  return {
    flex:         1,
    minHeight:    56,
    background:   bg,
    border:       `1px solid ${fg}`,
    borderRadius: 8,
    color:        fg,
    fontFamily:   'JetBrains Mono, monospace',
    fontSize:     14,
    fontWeight:   700,
    cursor:       'pointer',
    letterSpacing: 1,
  }
}

import { useState } from 'react'
import { useAudioAnalyzer } from '../../hooks/useAudioAnalyzer'
import SpectrumDisplay from './SpectrumDisplay'

const URGENCY_COLOR: Record<string, string> = {
  critical: '#ff3b30',
  warning:  '#ffb300',
  info:     '#0a84ff',
}

const URGENCY_LABEL: Record<string, string> = {
  critical: '위험',
  warning:  '주의',
  info:     '정보',
}

// 하울링 로그 최대 50개 유지
interface LogEntry { time: string; freq: number; note: string; db: number }

export default function HowlingDetector() {
  const { isActive, error, peak, spectrumData, start, stop, sampleRate } = useAudioAnalyzer()
  const [log, setLog] = useState<LogEntry[]>([])

  const handleStart = async () => {
    await start()
  }

  const handleStop = () => {
    stop()
  }

  // 피크가 감지될 때마다 로그에 추가 (중복 방지: 직전 주파수와 ±50Hz 이상 차이일 때만)
  const lastFreqRef = { current: 0 }
  if (peak && Math.abs(peak.freq - lastFreqRef.current) > 50) {
    lastFreqRef.current = peak.freq
    const entry: LogEntry = {
      time: new Date().toLocaleTimeString('ko-KR'),
      freq: peak.freq,
      note: peak.note,
      db:   peak.db,
    }
    setLog(prev => [entry, ...prev].slice(0, 50))
  }

  const copyLog = () => {
    const text = log.map(e =>
      `[${e.time}] ${Math.round(e.freq)}Hz (${e.note}) ${e.db.toFixed(1)}dBFS`
    ).join('\n')
    navigator.clipboard.writeText(text)
  }

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>

      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700,
                       letterSpacing: 2, color: 'var(--accent-green)' }}>
          HOWLING DETECTOR
        </span>
        {isActive && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12,
                         color: 'var(--accent-red)', fontFamily: 'monospace' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-red)',
                           animation: 'pulse 1s ease-in-out infinite', display: 'inline-block' }} />
            LIVE
          </span>
        )}
      </div>

      {/* 스펙트럼 */}
      <div style={{ padding: '0', background: '#000' }}>
        <SpectrumDisplay
          spectrumData={spectrumData}
          peakFreq={peak?.freq ?? null}
          sampleRate={sampleRate}
        />
      </div>

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* 에러 표시 */}
        {error && (
          <div style={{ background: '#1a0a0a', border: '1px solid var(--accent-red)',
                        borderRadius: 8, padding: '12px 16px', color: 'var(--accent-red)',
                        fontSize: 14, fontFamily: 'monospace' }}>
            {error}
          </div>
        )}

        {/* 피크 정보 패널 */}
        {peak ? (
          <div style={{ background: 'var(--bg-elevated)', border: `1px solid ${URGENCY_COLOR[peak.urgency]}`,
                        borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%',
                             background: URGENCY_COLOR[peak.urgency], display: 'inline-block' }} />
              <span style={{ color: URGENCY_COLOR[peak.urgency], fontFamily: 'monospace',
                             fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>
                {URGENCY_LABEL[peak.urgency]} — 피크 감지됨
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <InfoRow label="피크 주파수" value={
                peak.freq >= 1000
                  ? `${(peak.freq / 1000).toFixed(3)} kHz`
                  : `${Math.round(peak.freq)} Hz`
              } />
              <InfoRow label="강도" value={`${peak.db.toFixed(1)} dBFS`} />
              <InfoRow label="건반 음정" value={`${peak.note}  (${peak.cents > 0 ? '+' : ''}${peak.cents} cents)`} />
              <InfoRow label="MIDI 번호" value={String(peak.midi)} />
              <InfoRow label="파장 (λ)" value={`${(peak.wavelengthM * 100).toFixed(1)} cm`} />
              <InfoRow label="공기 중 파장" value={`${peak.wavelengthM.toFixed(3)} m`} />
            </div>
          </div>
        ) : isActive ? (
          <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                        borderRadius: 8, padding: 16, textAlign: 'center',
                        color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: 13 }}>
            하울링 없음 — 정상 상태 모니터링 중
          </div>
        ) : null}

        {/* EQ 대응 권고 */}
        {peak && (
          <div style={{ background: '#0a0800', border: `1px solid ${URGENCY_COLOR[peak.urgency]}33`,
                        borderRadius: 8, padding: 16 }}>
            <div style={{ fontSize: 11, letterSpacing: 1, color: 'var(--text-secondary)',
                          fontFamily: 'monospace', marginBottom: 10 }}>
              EQ 대응 권고
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <EQRow
                label="GEQ 밴드"
                value={peak.geqBand}
                color={URGENCY_COLOR[peak.urgency]}
              />
              <EQRow
                label="컷 권장"
                value={`${peak.cutDB} dB`}
                color={URGENCY_COLOR[peak.urgency]}
              />
              <EQRow
                label="Q 값"
                value={`${peak.Q.toFixed(1)}  (${peak.Q >= 4 ? '타이트' : '광대역'})`}
                color="var(--text-primary)"
              />
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-secondary)',
                          fontFamily: 'monospace', lineHeight: 1.6 }}>
              31밴드 GEQ에서 <strong style={{ color: URGENCY_COLOR[peak.urgency] }}>{peak.geqBand}</strong> 슬라이더를{' '}
              <strong style={{ color: URGENCY_COLOR[peak.urgency] }}>{peak.cutDB}dB</strong> 낮추세요.
              {peak.urgency === 'critical' && ' 즉각 조치가 필요합니다.'}
            </div>
          </div>
        )}

        {/* 컨트롤 버튼 */}
        <div style={{ display: 'flex', gap: 12 }}>
          {!isActive ? (
            <button onClick={handleStart} style={btnStyle('#00ff88', '#001a0d')}>
              마이크 시작
            </button>
          ) : (
            <button onClick={handleStop} style={btnStyle('#ff3b30', '#1a0000')}>
              중지
            </button>
          )}
          <button onClick={copyLog} disabled={log.length === 0}
            style={{ ...btnStyle('#0a84ff', '#000d1a'), opacity: log.length === 0 ? 0.4 : 1 }}>
            로그 복사
          </button>
        </div>

        {/* 감지 로그 */}
        {log.length > 0 && (
          <div style={{ background: '#000', border: '1px solid var(--border)', borderRadius: 8,
                        padding: 12, maxHeight: 160, overflowY: 'auto' }}>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace',
                          marginBottom: 8, letterSpacing: 1 }}>
              감지 로그 (최근 {log.length}건)
            </div>
            {log.map((e, i) => (
              <div key={i} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                                    color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                <span style={{ color: 'var(--text-muted)' }}>[{e.time}]</span>{' '}
                <span style={{ color: 'var(--accent-amber)' }}>
                  {e.freq >= 1000 ? `${(e.freq / 1000).toFixed(2)}kHz` : `${Math.round(e.freq)}Hz`}
                </span>{' '}
                <span style={{ color: 'var(--accent-green)' }}>({e.note})</span>{' '}
                <span style={{ color: e.db > -20 ? 'var(--accent-red)' : 'var(--text-secondary)' }}>
                  {e.db.toFixed(1)}dBFS
                </span>
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
      `}</style>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace',
                    letterSpacing: 1, marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontFamily: 'JetBrains Mono, monospace',
                    fontWeight: 700, color: 'var(--text-primary)' }}>
        {value}
      </div>
    </div>
  )
}

function EQRow({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
        {label}
      </span>
      <span style={{ fontSize: 16, fontFamily: 'JetBrains Mono, monospace',
                     fontWeight: 700, color }}>
        {value}
      </span>
    </div>
  )
}

function btnStyle(fg: string, bg: string): React.CSSProperties {
  return {
    flex: 1,
    minHeight: 56,
    background: bg,
    border: `1px solid ${fg}`,
    borderRadius: 8,
    color: fg,
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: 1,
  }
}

import { useState, useEffect, useRef, useCallback } from 'react'
import { useSupabaseRealtime, type ErrorLogRow, type HealingStatus } from '../../hooks/useSupabaseRealtime'
import { reportError, registerGlobalErrorHandlers, getSessionId, type ReportedError } from '../../lib/errorHandler'
import { isSupabaseConfigured } from '../../lib/supabaseClient'

// ── 상태별 색상·레이블 ───────────────────────────────────────────────────
const STATUS_META: Record<HealingStatus, { color: string; label: string; icon: string }> = {
  detecting:  { color: '#ffb300', label: '감지 중',     icon: '⚡' },
  parsing:    { color: '#0a84ff', label: '원인 분석',   icon: '🔍' },
  patching:   { color: '#bf5af2', label: '패치 생성',   icon: '🛠' },
  deploying:  { color: '#ff9f0a', label: '재배포 중',   icon: '🚀' },
  success:    { color: '#00ff88', label: '복구 완료',   icon: '✅' },
  failed:     { color: '#ff3b30', label: '수동 개입 필요', icon: '❌' },
}

// ── 데모 힐링 시뮬레이터 ────────────────────────────────────────────────
const DEMO_STEPS: Array<{ delay: number; status: HealingStatus; log: string }> = [
  { delay: 400,  status: 'detecting',  log: '⚡ 에러 감지: TypeError — Cannot read properties of null (reading "connect")' },
  { delay: 900,  status: 'detecting',  log: '   스택 트레이스 분석 중...' },
  { delay: 1500, status: 'parsing',    log: '🔍 원인 파싱: src/hooks/useAudioAnalyzer.ts:89' },
  { delay: 2200, status: 'parsing',    log: '   원인: audioCtx가 null인 상태에서 connect() 호출됨' },
  { delay: 3000, status: 'parsing',    log: '   iOS Safari webkitAudioContext 폴백 누락으로 추정' },
  { delay: 3800, status: 'patching',   log: '🛠 Groq API → 패치 코드 생성 중...' },
  { delay: 5000, status: 'patching',   log: '   diff: useAudioAnalyzer.ts L.34' },
  { delay: 5200, status: 'patching',   log: '   - const ctx = new AudioContext()' },
  { delay: 5400, status: 'patching',   log: '   + const Ctx = window.AudioContext ?? window.webkitAudioContext' },
  { delay: 5600, status: 'patching',   log: '   + if (!Ctx) throw new Error("Web Audio API 미지원")' },
  { delay: 5800, status: 'patching',   log: '   + const ctx = new Ctx()' },
  { delay: 6400, status: 'deploying',  log: '🚀 Git 커밋: auto-patch-a3f7c2e' },
  { delay: 7000, status: 'deploying',  log: '   GitHub Actions 트리거 → Vercel 빌드 시작' },
  { delay: 9000, status: 'deploying',  log: '   빌드 진행 중... (tsc → vite build)' },
  { delay: 12000,status: 'success',    log: '✅ 자가 치유 완료 (소요: 12.3초)' },
  { delay: 12400,status: 'success',    log: '   WebSocket 채널 해제됨 (비용 방어)' },
]

function useDemoHealer(active: boolean, onLine: (line: string, status: HealingStatus) => void, onDone: () => void) {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const run = useCallback(() => {
    timers.current.forEach(clearTimeout)
    timers.current = DEMO_STEPS.map(s =>
      setTimeout(() => {
        onLine(s.log, s.status)
        if (s.status === 'success') onDone()
      }, s.delay)
    )
  }, [onLine, onDone])

  useEffect(() => {
    if (!active) return
    return () => timers.current.forEach(clearTimeout)
  }, [active])

  return run
}

// ── 터미널 라인 파서 ─────────────────────────────────────────────────────
function lineColor(line: string): string {
  if (line.startsWith('✅') || line.includes('완료'))      return '#00ff88'
  if (line.startsWith('❌') || line.includes('실패'))      return '#ff3b30'
  if (line.startsWith('⚡') || line.startsWith('🔍'))      return '#ffb300'
  if (line.startsWith('🛠') || line.startsWith('   -'))    return '#bf5af2'
  if (line.startsWith('   +'))                              return '#00ff88'
  if (line.startsWith('🚀'))                               return '#ff9f0a'
  return '#8a8a8a'
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────
export default function LiveConsole() {
  const sessionId = getSessionId()
  const { rows, connected } = useSupabaseRealtime(sessionId)

  const [open,        setOpen]        = useState(false)
  const [demoActive,  setDemoActive]  = useState(false)
  const [demoLines,   setDemoLines]   = useState<Array<{ text: string; status: HealingStatus }>>([])
  const [demoStatus,  setDemoStatus]  = useState<HealingStatus | null>(null)
  const [errCount,    setErrCount]    = useState(0)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Supabase 없을 때 데모 라인 추가
  const addDemoLine = useCallback((text: string, status: HealingStatus) => {
    setDemoLines(prev => [...prev, { text, status }])
    setDemoStatus(status)
    setOpen(true)
  }, [])

  const onDemoDone = useCallback(() => {
    setTimeout(() => {
      setDemoActive(false)
    }, 2500)
  }, [])

  const runDemo = useDemoHealer(demoActive, addDemoLine, onDemoDone)

  // 전역 에러 리스너
  useEffect(() => {
    const cleanup = registerGlobalErrorHandlers((result: ReportedError) => {
      setErrCount(p => p + 1)
      setOpen(true)
      if (result.demo) {
        setDemoLines([])
        setDemoActive(true)
        runDemo()
      }
    })
    return cleanup
  }, [runDemo])

  // 오토 스크롤
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [demoLines, rows])

  // 강제 에러 유발 (테스트용)
  const triggerTestError = useCallback(() => {
    setDemoLines([])
    setDemoStatus(null)
    setDemoActive(true)
    setOpen(true)
    setTimeout(runDemo, 50)
    // 실제 에러도 동시 보고 (Supabase 있으면 DB에 기록)
    reportError(
      new TypeError('테스트: AudioContext null — 자가 치유 시뮬레이션'),
      'LiveConsole.triggerTestError'
    ).then(() => setErrCount(p => p + 1))
  }, [runDemo])

  // 표시할 로그 라인 (Supabase 실제 데이터 or 데모)
  const activeRows: ErrorLogRow[] = rows.filter(r => {
    const age = Date.now() - new Date(r.created_at).getTime()
    return age < 5 * 60 * 1000 // 5분 이내
  })
  const hasRealData = isSupabaseConfigured && activeRows.length > 0
  const currentStatus: HealingStatus | null = hasRealData
    ? (activeRows[0]?.status ?? null)
    : demoStatus

  const statusMeta = currentStatus ? STATUS_META[currentStatus] : null
  const isHealing = currentStatus && currentStatus !== 'success' && currentStatus !== 'failed'

  return (
    <>
      {/* ── 플로팅 토글 버튼 ──────────────────────────────────────── */}
      <button
        onClick={() => setOpen(p => !p)}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 999,
          width: 56, height: 56, borderRadius: '50%',
          border: `2px solid ${isHealing ? '#ffb300' : errCount > 0 ? '#ff3b30' : '#1f1f1f'}`,
          background: isHealing ? '#1a1000' : errCount > 0 ? '#1a0000' : '#0a0a0a',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: isHealing ? '0 0 16px #ffb30055' : 'none',
          transition: 'all 0.3s',
        }}
        title="Self-Healing Console"
      >
        <span style={{ fontSize: 20 }}>
          {isHealing ? '⚡' : errCount > 0 ? '🔴' : '🟢'}
        </span>
        {errCount > 0 && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            background: '#ff3b30', color: '#fff', borderRadius: '50%',
            width: 18, height: 18, fontSize: 10, fontFamily: 'monospace',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>{errCount}</span>
        )}
      </button>

      {/* ── 콘솔 패널 ────────────────────────────────────────────── */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 90, right: 24, zIndex: 998,
          width: Math.min(560, window.innerWidth - 48),
          maxHeight: 420,
          background: '#000',
          border: `1px solid ${statusMeta?.color ?? '#1f1f1f'}`,
          borderRadius: 12,
          boxShadow: `0 8px 32px #000, 0 0 0 1px ${statusMeta?.color ?? '#1f1f1f'}22`,
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          fontFamily: 'JetBrains Mono, Courier New, monospace',
        }}>

          {/* 헤더 바 */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '10px 14px', borderBottom: '1px solid #111',
            background: '#050505',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                {['#ff3b30','#ffb300','#00ff88'].map(c => (
                  <div key={c} style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />
                ))}
              </div>
              <span style={{ fontSize: 11, letterSpacing: 2, color: statusMeta?.color ?? '#555', fontWeight: 700 }}>
                SELF-HEALING CONSOLE
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* WebSocket 상태 */}
              <span style={{ fontSize: 10, color: connected ? '#00ff88' : '#333' }}>
                {connected ? '● WSS' : isSupabaseConfigured ? '○ WSS' : '○ DEMO'}
              </span>
              {/* 상태 배지 */}
              {statusMeta && (
                <span style={{
                  fontSize: 10, color: statusMeta.color,
                  background: statusMeta.color + '18',
                  border: `1px solid ${statusMeta.color}44`,
                  borderRadius: 4, padding: '2px 8px', letterSpacing: 1,
                }}>
                  {statusMeta.icon} {statusMeta.label}
                </span>
              )}
              <button onClick={() => setOpen(false)} style={{
                background: 'none', border: 'none', color: '#333', cursor: 'pointer', fontSize: 16, padding: 0,
              }}>✕</button>
            </div>
          </div>

          {/* 터미널 출력 영역 */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', minHeight: 120 }}>

            {/* Supabase 미설정 안내 */}
            {!isSupabaseConfigured && demoLines.length === 0 && (
              <div style={{ color: '#333', fontSize: 11, lineHeight: 1.8 }}>
                <span style={{ color: '#ffb300' }}>DEMO MODE</span> — Supabase 미설정<br />
                <span style={{ color: '#555' }}>.env.local에 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 추가 시 실제 WebSocket 스트리밍 활성화</span><br /><br />
                <span style={{ color: '#333' }}>아래 [테스트 에러 유발] 버튼으로 시뮬레이션을 확인하세요.</span>
              </div>
            )}

            {/* 데모 라인 */}
            {demoLines.map((line, i) => (
              <div key={i} style={{
                fontSize: 11, lineHeight: 1.8,
                color: lineColor(line.text),
                animation: i === demoLines.length - 1 ? 'fadeIn 0.2s ease-in' : 'none',
              }}>
                {line.text}
              </div>
            ))}

            {/* 실제 Supabase 데이터 */}
            {hasRealData && activeRows.map(row => (
              <div key={row.id} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 10, color: '#333', marginBottom: 4, letterSpacing: 1 }}>
                  [{new Date(row.created_at).toLocaleTimeString('ko-KR')}] {row.error_type}
                </div>
                {(row.healing_log ?? []).map((line, i) => (
                  <div key={i} style={{ fontSize: 11, lineHeight: 1.8, color: lineColor(line) }}>
                    {line}
                  </div>
                ))}
                {row.patch_code_diff && (
                  <div style={{
                    marginTop: 8, padding: '8px 10px', background: '#0a0014',
                    border: '1px solid #bf5af233', borderRadius: 4,
                    fontSize: 10, color: '#bf5af2', whiteSpace: 'pre',
                  }}>
                    {row.patch_code_diff}
                  </div>
                )}
              </div>
            ))}

            {/* 진행 중 커서 */}
            {isHealing && (
              <span style={{ color: statusMeta?.color ?? '#00ff88', animation: 'blink 1s step-end infinite' }}>▊</span>
            )}

            <div ref={bottomRef} />
          </div>

          {/* 하단 액션 바 */}
          <div style={{
            borderTop: '1px solid #111', padding: '10px 14px',
            display: 'flex', gap: 8, background: '#050505',
          }}>
            <button onClick={triggerTestError} disabled={demoActive} style={{
              flex: 1, padding: '7px 0', border: '1px solid #ff3b3044',
              borderRadius: 6, background: demoActive ? 'transparent' : '#1a0000',
              color: demoActive ? '#333' : '#ff3b30', cursor: demoActive ? 'default' : 'pointer',
              fontSize: 11, fontFamily: 'JetBrains Mono, monospace', letterSpacing: 1,
            }}>
              {demoActive ? '치유 진행 중...' : '⚡ 테스트 에러 유발'}
            </button>
            <button onClick={() => { setDemoLines([]); setDemoStatus(null); setErrCount(0) }} style={{
              padding: '7px 14px', border: '1px solid #1f1f1f',
              borderRadius: 6, background: 'transparent',
              color: '#555', cursor: 'pointer',
              fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
            }}>
              초기화
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes blink  { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
      `}</style>
    </>
  )
}

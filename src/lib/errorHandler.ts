import { supabase, isSupabaseConfigured } from './supabaseClient'

// 세션 ID: 탭 단위 고유 식별자
export function getSessionId(): string {
  let id = sessionStorage.getItem('soundmind_session')
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('soundmind_session', id) }
  return id
}

// 마지막 보고 시각 (중복 방지 디바운스 500ms)
let lastReportAt = 0

export interface ReportedError {
  id: string | null       // Supabase row id (null = 미설정)
  sessionId: string
  demo: boolean           // true = 데모 모드 (Supabase 미설정)
}

// ── 에러를 Supabase에 INSERT하고 row id 반환 ─────────────────────────────
export async function reportError(
  error: Error | string,
  context = ''
): Promise<ReportedError> {
  const now      = Date.now()
  const sessionId = getSessionId()
  const errObj   = typeof error === 'string' ? new Error(error) : error

  // 디바운스: 500ms 이내 중복 보고 차단
  if (now - lastReportAt < 500) return { id: null, sessionId, demo: !isSupabaseConfigured }
  lastReportAt = now

  const rawLog = {
    message:    errObj.message,
    stack:      errObj.stack ?? '',
    context,
    timestamp:  new Date().toISOString(),
    user_agent: navigator.userAgent.slice(0, 200),
  }

  const ts = new Date().toLocaleTimeString('ko-KR')

  if (!isSupabaseConfigured || !supabase) {
    // 데모 모드: 콘솔에 기록 후 임시 ID 반환
    console.warn('[SoundMind Healer] 데모 모드 — Supabase 미설정', rawLog)
    return { id: `demo-${crypto.randomUUID()}`, sessionId, demo: true }
  }

  try {
    const { data, error: dbErr } = await supabase!
      .from('error_logs')
      .insert({
        error_type:  errObj.name || 'Error',
        raw_log:     rawLog,
        status:      'detecting',
        session_id:  sessionId,
        healing_log: [`[${ts}] ⚡ 에러 감지: ${errObj.message.slice(0, 120)}`],
      })
      .select('id')
      .single()

    if (dbErr) { console.error('[SoundMind] Supabase INSERT 실패:', dbErr.message); return { id: null, sessionId, demo: false } }
    return { id: (data as { id: string } | null)?.id ?? null, sessionId, demo: false }
  } catch (e) {
    console.error('[SoundMind] 에러 보고 실패:', e)
    return { id: null, sessionId, demo: false }
  }
}

// ── Supabase 상태 업데이트 (하네스 → UI 스트리밍) ────────────────────────
export async function updateHealingStatus(
  rowId: string,
  status: string,
  _logLine: string,
  patchDiff?: string
): Promise<void> {
  if (!supabase || rowId.startsWith('demo-')) return

  const resolved = (status === 'success' || status === 'failed') ? new Date().toISOString() : undefined
  await supabase!
    .from('error_logs')
    .update({
      status,
      ...(patchDiff ? { patch_code_diff: patchDiff } : {}),
      ...(resolved  ? { resolved_at: resolved }       : {}),
    })
    .eq('id', rowId)
}

// ── 전역 에러 리스너 등록 ────────────────────────────────────────────────
export function registerGlobalErrorHandlers(
  onError: (err: ReportedError) => void
): () => void {
  const handleError = async (event: ErrorEvent) => {
    // 외부 스크립트·브라우저 확장 에러 무시
    if (!event.filename || event.filename.includes('extension')) return
    event.preventDefault?.()
    const err = event.error instanceof Error ? event.error : new Error(event.message)
    const msg = err.message.toLowerCase()
    if (msg.includes('fetch') || msg.includes('network') || msg.includes('script error')) return
    const result = await reportError(err, `window.onerror @ ${event.filename}:${event.lineno}`)
    onError(result)
  }

  const handleUnhandledRejection = async (event: PromiseRejectionEvent) => {
    const err = event.reason instanceof Error ? event.reason : new Error(String(event.reason))
    // 네트워크 에러(fetch 실패, CORS 등) 및 Supabase 내부 에러는 무시
    // → ChatPanel의 try/catch가 이미 처리하므로 중복 보고 방지
    const msg = err.message.toLowerCase()
    if (
      msg.includes('fetch') ||
      msg.includes('network') ||
      msg.includes('failed to fetch') ||
      msg.includes('load failed') ||
      msg.includes('networkerror') ||
      msg.includes('supabase') ||
      msg.includes('aborted')
    ) return
    const result = await reportError(err, 'UnhandledPromiseRejection')
    onError(result)
  }

  window.addEventListener('error', handleError)
  window.addEventListener('unhandledrejection', handleUnhandledRejection)
  return () => {
    window.removeEventListener('error', handleError)
    window.removeEventListener('unhandledrejection', handleUnhandledRejection)
  }
}

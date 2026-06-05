/**
 * Supabase Admin 클라이언트 (서버사이드 — service_role 키 사용)
 * GitHub Actions 하네스 전용. 브라우저에서 사용 금지.
 */

const SUPABASE_URL = process.env.SUPABASE_URL ?? ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY ?? ''

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.warn('[supabaseAdmin] 환경변수 미설정 — dry-run 모드로 동작')
}

async function sbFetch(path, options = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) return null
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey':        SERVICE_KEY,
      'Authorization': `Bearer ${SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
      ...(options.headers ?? {}),
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error('[supabaseAdmin] 요청 실패:', res.status, body.slice(0, 200))
    return null
  }
  return res.json().catch(() => null)
}

// ── 에러 로그 단건 조회 ───────────────────────────────────────────────────
export async function fetchErrorLog(id) {
  const data = await sbFetch(`error_logs?id=eq.${id}&limit=1`)
  return Array.isArray(data) ? data[0] ?? null : null
}

// ── 상태 + 로그 업데이트 (PATCH) ─────────────────────────────────────────
export async function updateStatus(id, status, logLine, patchDiff = null) {
  const ts = new Date().toLocaleTimeString('ko-KR', { hour12: false })
  const line = `[${ts}] ${logLine}`

  console.log(`[Healer] ${status.toUpperCase()} — ${logLine}`)

  if (!SUPABASE_URL || !SERVICE_KEY) return   // dry-run

  // healing_log 배열에 append (PostgreSQL array_append 사용)
  await sbFetch(`rpc/append_healing_log_rpc`, {
    method: 'POST',
    body: JSON.stringify({ p_id: id, p_line: line, p_status: status }),
  }).catch(async () => {
    // RPC 없는 경우 직접 UPDATE fallback
    const resolved = (status === 'success' || status === 'failed')
      ? new Date().toISOString() : undefined
    await sbFetch(`error_logs?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status,
        ...(patchDiff ? { patch_code_diff: patchDiff } : {}),
        ...(resolved  ? { resolved_at: resolved }       : {}),
      }),
    })
  })
}

// ── 실패 마킹 ────────────────────────────────────────────────────────────
export async function markFailed(id, reason) {
  await updateStatus(id, 'failed', `❌ 자동 복구 실패: ${reason}`)
}

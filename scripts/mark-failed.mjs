/**
 * GitHub Actions 실패 시 Supabase 상태 업데이트
 * .github/workflows/self-healing.yml의 on-failure 스텝에서 호출
 */
import { markFailed } from './lib/supabaseAdmin.mjs'

const id = process.env.ERROR_LOG_ID?.trim() ?? ''
if (id) {
  await markFailed(id, 'GitHub Actions 워크플로 실패 — 로그 확인 필요')
  console.log('[mark-failed] 상태 업데이트 완료:', id)
} else {
  console.log('[mark-failed] ERROR_LOG_ID 없음 — 스킵')
}

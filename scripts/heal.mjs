#!/usr/bin/env node
/**
 * SoundMind Self-Healing Harness
 * GitHub Actions에서 실행되는 메인 치유 스크립트
 *
 * 환경변수:
 *   ANTHROPIC_API_KEY    — Claude API 키
 *   SUPABASE_URL         — Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_KEY — Supabase service_role 키
 *   ERROR_LOG_ID         — error_logs 테이블 UUID
 *   DRY_RUN              — 'true'이면 파일 수정 없이 분석만
 *   GITHUB_REPOSITORY    — 'owner/repo' (자동 주입)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { execSync }   from 'child_process'
import { resolve }    from 'path'
import { fetchErrorLog, updateStatus, markFailed } from './lib/supabaseAdmin.mjs'
import { analyzeAndPatch } from './lib/claudeClient.mjs'

const DRY_RUN      = process.env.DRY_RUN === 'true'
const ERROR_LOG_ID = process.env.ERROR_LOG_ID?.trim() ?? ''
const PROJECT_ROOT = resolve(import.meta.dirname, '..')

// GitHub Actions output 헬퍼
function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT
  if (outputFile) {
    const { appendFileSync } = await import('fs').catch(() => ({ appendFileSync: () => {} }))
    appendFileSync(outputFile, `${key}=${value}\n`)
  }
  console.log(`[output] ${key}=${value}`)
}

// 스택에서 src/ 파일 경로 추출
function extractSrcFiles(stack = '') {
  const matches = [...stack.matchAll(/\b(src\/[^\s:)]+\.tsx?)/g)]
  const unique  = [...new Set(matches.map(m => m[1]))]
  return unique
    .filter(p => existsSync(resolve(PROJECT_ROOT, p)))
    .slice(0, 4)
    .map(p => ({
      path:    p,
      content: readFileSync(resolve(PROJECT_ROOT, p), 'utf8'),
    }))
}

// 패치 적용
function applyPatches(patches) {
  let applied = 0
  for (const patch of patches) {
    const fullPath = resolve(PROJECT_ROOT, patch.file)
    if (!existsSync(fullPath)) { console.warn(`[heal] 파일 없음: ${patch.file}`); continue }

    const original = readFileSync(fullPath, 'utf8')
    if (!original.includes(patch.oldCode)) {
      console.warn(`[heal] 대상 코드 미발견: ${patch.file}`)
      continue
    }

    const patched = original.replace(patch.oldCode, patch.newCode)
    if (!DRY_RUN) {
      writeFileSync(fullPath, patched, 'utf8')
      console.log(`[heal] ✓ 패치 적용: ${patch.file}`)
    } else {
      console.log(`[heal] DRY-RUN — 패치 미적용: ${patch.file}`)
    }
    applied++
  }
  return applied
}

// TypeScript 빌드 검증
function verifyBuild() {
  try {
    execSync('npm run build', { cwd: PROJECT_ROOT, stdio: 'inherit' })
    return true
  } catch {
    return false
  }
}

// ── 메인 ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔧 SoundMind Self-Healing Harness 시작\n')
  console.log('  DRY_RUN:      ', DRY_RUN)
  console.log('  ERROR_LOG_ID: ', ERROR_LOG_ID || '(없음)')
  console.log('  PROJECT_ROOT: ', PROJECT_ROOT)

  // ── 에러 로그 조회 ───────────────────────────────────────────────────
  // status: detecting → 하네스가 수신 확인
  if (ERROR_LOG_ID) {
    await updateStatus(ERROR_LOG_ID, 'detecting', '⚡ 하네스 수신 확인 — 분석 시작')
  }

  if (!ERROR_LOG_ID) {
    console.log('\n[heal] ERROR_LOG_ID 없음 — 데모 패스스루 모드')
    setOutput('patched', 'false')
    setOutput('patch_summary', 'no-error-id')
    return
  }

  await updateStatus(ERROR_LOG_ID, 'parsing', '🔍 에러 로그 조회 중...')
  const errorLog = await fetchErrorLog(ERROR_LOG_ID)

  if (!errorLog) {
    await markFailed(ERROR_LOG_ID, 'error_logs 행을 찾을 수 없음')
    setOutput('patched', 'false')
    return
  }

  console.log('\n[heal] 에러 정보:')
  console.log('  타입:', errorLog.error_type)
  console.log('  메시지:', errorLog.raw_log?.message?.slice(0, 100))

  // ── 소스 파일 추출 ───────────────────────────────────────────────────
  const stack       = errorLog.raw_log?.stack ?? ''
  const sourceFiles = extractSrcFiles(stack)
  console.log('\n[heal] 관련 파일:', sourceFiles.map(f => f.path))

  await updateStatus(
    ERROR_LOG_ID, 'parsing',
    `🔍 관련 파일 ${sourceFiles.length}개 분석 중: ${sourceFiles.map(f => f.path).join(', ')}`
  )

  // ── Claude API 분석 ──────────────────────────────────────────────────
  await updateStatus(ERROR_LOG_ID, 'patching', '🤖 Claude API → 패치 코드 생성 중...')
  const result = await analyzeAndPatch(errorLog, sourceFiles)

  console.log('\n[heal] Claude 분석:')
  console.log('  신뢰도:', result.confidence + '%')
  console.log('  분석:', result.analysis)
  console.log('  패치 파일:', result.filesToPatch)

  await updateStatus(
    ERROR_LOG_ID, 'patching',
    `🛠 패치 생성 완료 (신뢰도 ${result.confidence}%): ${result.analysis}`,
    result.patchDiff
  )

  // 신뢰도 낮으면 실패 처리
  if (result.confidence < 40) {
    await markFailed(ERROR_LOG_ID, `신뢰도 ${result.confidence}% — 수동 검토 필요`)
    setOutput('patched', 'false')
    setOutput('patch_summary', `low-confidence-${result.confidence}`)
    return
  }

  // ── 패치 적용 ────────────────────────────────────────────────────────
  const appliedCount = applyPatches(result.patches ?? [])
  console.log(`\n[heal] 적용된 패치: ${appliedCount}개`)

  if (appliedCount === 0) {
    await updateStatus(ERROR_LOG_ID, 'failed', '❌ 패치 적용 실패 — 코드 위치 불일치')
    setOutput('patched', 'false')
    setOutput('patch_summary', 'patch-apply-failed')
    return
  }

  // ── 빌드 검증 ────────────────────────────────────────────────────────
  await updateStatus(ERROR_LOG_ID, 'deploying', '🔨 TypeScript 빌드 검증 중...')
  const buildOk = DRY_RUN || verifyBuild()

  if (!buildOk) {
    // 빌드 실패 시 패치 롤백
    if (!DRY_RUN) {
      try { execSync('git checkout -- .', { cwd: PROJECT_ROOT }) } catch {}
    }
    await markFailed(ERROR_LOG_ID, '패치 적용 후 빌드 실패 — 롤백 완료')
    setOutput('patched', 'false')
    setOutput('patch_summary', 'build-failed-rolled-back')
    return
  }

  // ── 성공 ─────────────────────────────────────────────────────────────
  await updateStatus(ERROR_LOG_ID, 'deploying', '🚀 Vercel 자동 배포 시작 (git push 트리거)...')

  const summary = result.filesToPatch.length > 0
    ? result.filesToPatch.join(', ')
    : 'no-files'

  setOutput('patched', 'true')
  setOutput('patch_summary', summary.slice(0, 100))

  // Vercel은 git push 시 자동 배포 (GitHub Actions가 커밋 후 push)
  await updateStatus(ERROR_LOG_ID, 'success', '✅ 자가 치유 완료 — Vercel 배포 진행 중')

  console.log('\n✅ Self-Healing 완료\n')
}

main().catch(async err => {
  console.error('[heal] 치명적 오류:', err.message)
  if (ERROR_LOG_ID) {
    await markFailed(ERROR_LOG_ID, err.message.slice(0, 200)).catch(() => {})
  }
  setOutput('patched', 'false')
  process.exit(1)
})

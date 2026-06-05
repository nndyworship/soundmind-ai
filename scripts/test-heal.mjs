#!/usr/bin/env node
/**
 * 로컬 자가 치유 파이프라인 테스트
 * 실행: node scripts/test-heal.mjs
 */

import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// .env.local 파싱
function loadEnv() {
  try {
    const lines = readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split('\n')
    lines.forEach(line => {
      const [k, ...v] = line.split('=')
      if (k?.trim() && v.length) process.env[k.trim()] = v.join('=').trim()
    })
    console.log('✓ .env.local 로드')
  } catch {
    console.log('⚠ .env.local 없음')
  }
}

loadEnv()

// ── 파이프라인 시뮬레이션 (실제 Supabase 없이) ───────────────────────────
async function runLocalTest() {
  console.log('\n=== SoundMind Self-Healing 로컬 테스트 ===\n')

  // 테스트용 가상 에러 로그
  const mockErrorLog = {
    id:         'test-' + Math.random().toString(36).slice(2),
    error_type: 'TypeError',
    raw_log: {
      message: "Cannot read properties of null (reading 'connect')",
      stack:   [
        "TypeError: Cannot read properties of null",
        "    at useAudioAnalyzer (src/hooks/useAudioAnalyzer.ts:89:18)",
        "    at HowlingDetector (src/components/utils/HowlingDetector.tsx:12:3)",
      ].join('\n'),
      context:   'HowlingDetector.start',
      timestamp: new Date().toISOString(),
    },
    status:     'detecting',
    session_id: 'local-test-session',
  }

  console.log('[테스트] 가상 에러:', mockErrorLog.raw_log.message)

  // ── 소스 파일 추출 테스트 ────────────────────────────────────────────
  const { existsSync } = await import('fs')
  const projectRoot    = resolve(__dirname, '..')
  const stack          = mockErrorLog.raw_log.stack
  const matches        = [...stack.matchAll(/\b(src\/[^\s:)]+\.tsx?)/g)]
  const srcFiles       = [...new Set(matches.map(m => m[1]))]
    .filter(p => existsSync(resolve(projectRoot, p)))

  console.log('[테스트] 추출된 소스 파일:', srcFiles.length + '개')
  srcFiles.forEach(f => console.log('  -', f))

  // ── Claude API 분석 테스트 ───────────────────────────────────────────
  const { analyzeAndPatch } = await import('./lib/claudeClient.mjs')

  const fileContents = srcFiles.slice(0, 2).map(p => ({
    path:    p,
    content: readFileSync(resolve(projectRoot, p), 'utf8').slice(0, 2000),
  }))

  console.log('\n[테스트] Claude API 호출 중...')
  const result = await analyzeAndPatch(mockErrorLog, fileContents)

  console.log('\n=== Claude 분석 결과 ===')
  console.log('신뢰도:', result.confidence + '%')
  console.log('분석:',   result.analysis)
  console.log('패치 파일:', result.filesToPatch)

  if (result.patchDiff) {
    console.log('\n=== Unified Diff ===')
    console.log(result.patchDiff.slice(0, 600))
  }

  if (result.patches?.length > 0) {
    console.log('\n=== 패치 상세 ===')
    result.patches.forEach((p, i) => {
      console.log(`[${i}] ${p.file}: ${p.reason}`)
    })
  }

  // ── GitHub Dispatch 시뮬레이션 ───────────────────────────────────────
  console.log('\n=== GitHub Actions Dispatch 시뮬레이션 ===')
  const ghToken = process.env.GITHUB_TOKEN ?? ''
  const ghRepo  = process.env.GITHUB_REPOSITORY ?? 'owner/soundmind-ai'

  if (ghToken) {
    console.log('GitHub Token: 설정됨 — 실제 dispatch 가능')
    const dispatchUrl = `https://api.github.com/repos/${ghRepo}/dispatches`
    console.log('Dispatch URL:', dispatchUrl)
    console.log('Payload:', JSON.stringify({
      event_type:     'soundmind-error',
      client_payload: { error_log_id: mockErrorLog.id, error_type: mockErrorLog.error_type },
    }, null, 2))
  } else {
    console.log('GITHUB_TOKEN 없음 — dispatch 스킵 (실제 배포 시 Supabase 웹훅이 자동 트리거)')
  }

  console.log('\n✅ 로컬 테스트 완료')
  console.log('   Supabase + GitHub Secrets 설정 후 전체 파이프라인 활성화')
}

runLocalTest().catch(e => { console.error('테스트 실패:', e.message); process.exit(1) })

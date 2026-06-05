/**
 * Anthropic Claude API 래퍼 — 자가 치유 패치 생성
 * 모델: claude-sonnet-4-6 (최신 Claude 4 계열)
 */

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? ''
const MODEL         = 'claude-sonnet-4-6'

// ── 에러 분석 + 패치 생성 ────────────────────────────────────────────────
export async function analyzeAndPatch(errorLog, sourceFiles) {
  if (!ANTHROPIC_KEY) {
    console.warn('[claudeClient] ANTHROPIC_API_KEY 미설정 — 더미 패치 반환')
    return {
      analysis:     'API 키 없음 — 더미 분석',
      patchDiff:    '',
      filesToPatch: [],
      confidence:   0,
    }
  }

  const errorMsg   = errorLog.raw_log?.message  ?? '알 수 없는 에러'
  const stackTrace = errorLog.raw_log?.stack     ?? ''
  const context    = errorLog.raw_log?.context   ?? ''
  const errorType  = errorLog.error_type         ?? 'Error'

  const fileBlock = sourceFiles.map(f =>
    `=== ${f.path} ===\n${f.content.slice(0, 3000)}`
  ).join('\n\n')

  const prompt = `당신은 React + TypeScript + Vite 프로젝트의 자동 패치 엔지니어입니다.

## 에러 정보
- 타입: ${errorType}
- 메시지: ${errorMsg}
- 컨텍스트: ${context}

## 스택 트레이스
\`\`\`
${stackTrace.slice(0, 2000)}
\`\`\`

## 관련 소스 파일
${fileBlock}

## 지시사항
1. 에러 원인을 정확히 분석하세요.
2. 최소한의 코드 변경으로 버그를 수정하세요.
3. 아래 JSON 형식으로만 응답하세요. 다른 텍스트 금지.

## 응답 형식 (JSON only)
{
  "analysis": "에러 원인 1~2문장",
  "confidence": 0~100,
  "patches": [
    {
      "file": "파일 경로 (src/로 시작)",
      "oldCode": "변경 전 코드 (정확히 일치해야 함)",
      "newCode": "변경 후 코드",
      "reason": "변경 이유 1문장"
    }
  ]
}`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 2000,
        messages:   [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(60000),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Claude API ${res.status}: ${err.slice(0, 200)}`)
    }

    const data = await res.json()
    const text = data.content?.[0]?.text ?? ''

    // JSON 파싱
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('Claude 응답에 JSON 없음')

    const parsed = JSON.parse(jsonMatch[0])

    // unified diff 생성
    const patchDiff = (parsed.patches ?? []).map(p =>
      `--- a/${p.file}\n+++ b/${p.file}\n` +
      p.oldCode.split('\n').map(l => `- ${l}`).join('\n') + '\n' +
      p.newCode.split('\n').map(l => `+ ${l}`).join('\n')
    ).join('\n\n')

    return {
      analysis:     parsed.analysis     ?? '',
      confidence:   parsed.confidence   ?? 0,
      patches:      parsed.patches      ?? [],
      patchDiff,
      filesToPatch: (parsed.patches ?? []).map(p => p.file),
    }
  } catch (e) {
    console.error('[claudeClient] 에러:', e.message)
    return { analysis: e.message, patchDiff: '', filesToPatch: [], confidence: 0, patches: [] }
  }
}

// ── 스택 트레이스에서 파일 경로 추출 ─────────────────────────────────────
export function extractSourceFiles(stackTrace, projectRoot) {
  const { readFileSync, existsSync } = await import('fs')

  const matches = [...stackTrace.matchAll(/\(?(src\/[^:)]+\.tsx?)/g)]
  const paths   = [...new Set(matches.map(m => m[1]))]

  return paths
    .filter(p => existsSync(`${projectRoot}/${p}`))
    .slice(0, 5)     // 최대 5개 파일
    .map(p => ({
      path:    p,
      content: readFileSync(`${projectRoot}/${p}`, 'utf8'),
    }))
}

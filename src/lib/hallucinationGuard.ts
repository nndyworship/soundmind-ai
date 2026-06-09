// SPEC: AI 응답은 반드시 이 함수를 통과한 후 렌더링
// [UNVERIFIED] 태그 문장을 분리하고, 인용 URL을 소스 목록과 대조 검증

export interface GuardedLine {
  text: string
  verified: boolean
}

export interface Source {
  url: string
  title: string
  domain: string
  snippet: string
}

// 문장 단위로 분리 후 [UNVERIFIED] 태그 감지
export function parseGuardedText(raw: string): GuardedLine[] {
  if (!raw.trim()) return []

  return raw
    .split('\n')
    .map(line => {
      const isUnverified = line.includes('[UNVERIFIED]')
      return {
        text: line.replace(/\[UNVERIFIED\]/g, '').trim(),
        verified: !isUnverified,
      }
    })
    .filter(line => line.text.length > 0)
}

// 응답 텍스트 안의 [참고N] 인용이 실제 소스 목록에 있는지 대조
export function validateCitations(raw: string, sources: Source[]): boolean {
  const citations = raw.match(/\[참고\d+\]/g) ?? []
  if (citations.length === 0) return true // 인용 없으면 패스 (경험 기반 발언)

  return citations.every(c => {
    const idx = parseInt(c.replace(/\D/g, ''), 10) - 1
    return idx >= 0 && idx < sources.length
  })
}

// 검증된 줄만 이어 붙이기 (렌더링 차단용)
export function renderVerifiedOnly(lines: GuardedLine[]): string {
  return lines
    .filter(l => l.verified)
    .map(l => l.text)
    .join('\n')
}

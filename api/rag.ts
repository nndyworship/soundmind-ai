import type { VercelRequest, VercelResponse } from '@vercel/node'

// ── 도메인 분류 테이블 ────────────────────────────────────────────────────
const OFFICIAL_DOMAINS = [
  'pro.yamaha.com','usa.yamaha.com','yamahapro.com','yamaha.com',
  'pubs.shure.com','shure.com',
  'qsc.com','qsys.com',
  'allen-heath.com',
  'soundcraft.com',
  'roland.com','boss.info',
  'presonus.com',
  'avid.com',
  'digico.biz',
  'mackie.com',
  'dbxpro.com',
  'behringer.com',
  'midas-music.com',
  'klipsch.com',
  'jblpro.com','jbl.com',
  'sennheiser.com',
  'audio-technica.com',
  'wisycom.com',
  'lectrosonics.com',
  'danteaudio.com',
  'audinate.com',
  'l-acoustics.com',
  'dbaudio.com',
]

const COMMUNITY_DOMAINS = [
  'prosoundweb.com',
  'gearspace.com',
  'reddit.com',
  'gearslutz.com',
  'mixonline.com',
  'soundonsound.com',
  'vi-control.net',
  'kvraudio.com',
  'sweetwater.com',
  'bhphotovideo.com',
  'musiciansfriend.com',
  'guitarcenter.com',
  'thomann.de',
  'zzounds.com',
]

type TrackResult = {
  label:    string
  sources:  Array<{ url: string; title: string; domain: string; snippet: string }>
  answer:   string
  verified: boolean
}

type RagResponse = {
  query:        string
  expertAnswer: string
  trackA:       TrackResult
  trackB:       TrackResult
  meta: {
    totalSources:     number
    officialCount:    number
    communityCount:   number
    groqConfigured:   boolean
    tavilyConfigured: boolean
    searchQueries:    string[]
  }
}

// ── 의도 감지 + 정밀 검색어 생성 ────────────────────────────────────────────
type QueryIntent = 'recommend' | 'troubleshoot' | 'setup' | 'general'

function detectIntent(query: string): QueryIntent {
  if (/추천|비교|어떤.*살|구매|살만|좋은|최고|best|vs\b|versus/i.test(query)) return 'recommend'
  if (/안됨|노이즈|하울링|buzz|hum|noise|feedback|문제|오류|고장|왜|이상|끊김/i.test(query)) return 'troubleshoot'
  if (/설정|셋업|연결|setup|routing|patch|gain|eq|컴프|딜레이|리버브/i.test(query)) return 'setup'
  return 'general'
}

// 한국어 쿼리 → 영어 검색어 핵심 키워드 추출
function extractEnglishKeywords(query: string): string {
  const brandMap: Record<string, string> = {
    '야마하': 'Yamaha', '샤이어': 'Shure', '슈어': 'Shure',
    '알렌히스': 'Allen Heath', '알렌앤히스': 'Allen Heath',
    '디지코': 'DiGiCo', '큐에스씨': 'QSC', '베링거': 'Behringer',
    '마이다스': 'Midas', '프리소너스': 'PreSonus', '맥키': 'Mackie',
    '젠하이저': 'Sennheiser', '오디오테크니카': 'Audio-Technica',
    '엘어쿠스틱스': 'L-Acoustics',
    '디앤비': 'd&b audiotechnik', '단테': 'Dante',
  }
  const categoryMap: Record<string, string> = {
    '디지털믹서': 'digital mixer console',
    '디지털 믹서': 'digital mixer console',
    '아날로그믹서': 'analog mixer console',
    '아날로그 믹서': 'analog mixer console',
    '무선마이크': 'wireless microphone system',
    '무선 마이크': 'wireless microphone system',
    '콘덴서마이크': 'condenser microphone',
    '다이나믹마이크': 'dynamic microphone',
    '스피커': 'PA speaker', '모니터': 'stage monitor speaker',
    '인이어': 'in-ear monitor IEM', '이어모니터': 'in-ear monitor IEM',
    '파워앰프': 'power amplifier', '프로세서': 'audio processor',
    '이퀄라이저': 'equalizer EQ', '컴프레서': 'compressor',
    '인터페이스': 'audio interface', '믹싱': 'mixing',
    '라이브': 'live sound', '교회': 'church audio',
    '하울링': 'feedback howling', '노이즈': 'noise',
  }

  let result = query
  for (const [ko, en] of Object.entries(brandMap))  result = result.replace(new RegExp(ko, 'gi'), en)
  for (const [ko, en] of Object.entries(categoryMap)) result = result.replace(new RegExp(ko, 'gi'), en)
  return result
}

function buildSearchQueries(query: string, intent: QueryIntent): string[] {
  const en = extractEnglishKeywords(query)
  const year = '2024 2025 2026'

  switch (intent) {
    case 'recommend':
      return [
        `best ${en} ${year} review comparison`,
        `new ${en} release ${year} features`,
        `${en} recommendation live sound engineer ${year}`,
      ]
    case 'troubleshoot':
      return [
        `${en} troubleshooting fix solution`,
        `${en} problem cause repair`,
      ]
    case 'setup':
      return [
        `${en} setup configuration guide`,
        `${en} routing settings how to`,
      ]
    default:
      return [`${en} audio professional`, `${en} review specifications`]
  }
}

// ── Tavily 검색 ───────────────────────────────────────────────────────────
async function searchTavily(
  query: string,
  apiKey: string,
  depth: 'basic' | 'advanced' = 'basic'
): Promise<Array<{ url: string; title: string; snippet: string }>> {
  if (!apiKey) return []
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key:         apiKey,
        query,
        search_depth:    depth,
        max_results:     8,
        include_answer:  false,
        include_raw_content: false,
      }),
      signal: AbortSignal.timeout(9000),
    })
    if (!res.ok) return []
    const data = await res.json() as {
      results?: Array<{ url: string; title: string; content: string; score?: number }>
    }
    return (data.results ?? [])
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .map(r => ({
        url:     r.url,
        title:   r.title,
        snippet: (r.content ?? '').slice(0, 800), // 400 → 800자: 모델명·스펙 잘림 방지
      }))
  } catch {
    return []
  }
}

// ── DuckDuckGo 폴백 ───────────────────────────────────────────────────────
async function searchDDG(query: string): Promise<Array<{ url: string; title: string; snippet: string }>> {
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://duckduckgo.com/',
        },
        signal: AbortSignal.timeout(8000),
      }
    )
    if (!res.ok) return []
    const html = await res.text()
    const results: Array<{ url: string; title: string; snippet: string }> = []
    const seen = new Set<string>()

    const blocks = html.split('class="links_main links_deep result__body"')
    for (let i = 1; i < blocks.length && results.length < 6; i++) {
      const block = blocks[i]!
      const uddgMatch    = block.match(/uddg=([^&"]+)/)
      const titleMatch   = block.match(/class="result__a"[^>]*>(?:<[^>]+>)*([^<]+)/)
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([^<]*(?:<(?!\/a)[^>]*>[^<]*)*)/)

      const rawUrl  = uddgMatch?.[1] ? decodeURIComponent(uddgMatch[1]) : ''
      const title   = titleMatch?.[1]?.trim().replace(/&amp;/g,'&').replace(/&quot;/g,'"') ?? ''
      const snippet = (snippetMatch?.[1] ?? '')
        .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0, 800)

      if (!rawUrl || !title || seen.has(rawUrl)) continue
      seen.add(rawUrl)
      results.push({ url: rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`, title, snippet })
    }
    return results
  } catch {
    return []
  }
}

// ── URL → 도메인 ─────────────────────────────────────────────────────────
function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') }
  catch { return url }
}

// ── 소스 분류 ─────────────────────────────────────────────────────────────
function classifySource(url: string): 'official' | 'community' | 'other' {
  const lc = url.toLowerCase()
  if (OFFICIAL_DOMAINS.some(d => lc.includes(d)))  return 'official'
  if (COMMUNITY_DOMAINS.some(d => lc.includes(d))) return 'community'
  return 'other'
}

// ── 전문가 AI 답변 ────────────────────────────────────────────────────────
async function synthesizeExpert(
  apiKey:    string,
  userQuery: string,
  intent:    QueryIntent,
  sources:   Array<{ url: string; title: string; snippet: string }>
): Promise<string> {
  if (!apiKey) return ''

  // 검색 결과를 상세하게 전달 (모델명·스펙이 잘리지 않도록)
  const sourceBlock = sources
    .slice(0, 8)
    .map((s, i) => `[검색${i + 1}] ${s.title}\n출처: ${s.url}\n내용: ${s.snippet}`)
    .join('\n\n---\n\n')

  const expertPersona = `당신은 20년 경력의 라이브 음향 엔지니어입니다.
콘서트홀, 스타디움, 교회, 클럽 등 다양한 현장 경험과 함께
Yamaha CL/QL/PM, DiGiCo SD/Quantum, Allen & Heath dLive/SQ/Avantis,
Shure/Sennheiser/Wisycom 무선, L-Acoustics/d&b/QSC 스피커,
Dante/MADI/AVB 네트워크 오디오를 깊이 다뤄왔습니다.`

  const intentInstructions: Record<QueryIntent, string> = {
    recommend: `
장비 추천 요령:
1. 반드시 아래 검색 결과에서 언급된 구체적인 모델명을 포함해 답변하세요.
2. 검색 결과 기준 최신 모델(2024~2026)을 우선 추천하세요.
3. 예산별/용도별로 1순위·2순위·예산대안 3가지를 구분해 추천하세요.
4. 각 추천 장비의 핵심 장점 1~2줄과 주의사항을 함께 적으세요.
5. 검색 결과에 없는 장비를 추천할 때는 "(기존 지식 기반)"이라고 표시하세요.
6. 절대 존재하지 않는 모델명이나 스펙을 지어내지 마세요.`,

    troubleshoot: `
문제 해결 요령:
1. 원인 → 점검 순서 → 해결 방법 순으로 설명하세요.
2. 구체적인 설정값(dB, Hz, ms)을 제시하세요.
3. 검색 결과에 관련 해결책이 있으면 반드시 반영하세요.
4. 초보자가 놓치기 쉬운 함정을 한 가지 이상 포함하세요.`,

    setup: `
셋업 안내 요령:
1. 단계별 순서로 명확하게 설명하세요.
2. 구체적인 설정값을 포함하세요.
3. 검색 결과의 실무 팁을 반영하세요.`,

    general: `
1. 핵심 답을 먼저 제시하고, 배경 설명을 덧붙이세요.
2. 검색 결과의 관련 정보를 반영하세요.`,
  }

  const systemPrompt = `${expertPersona}

${intentInstructions[intent]}

공통 규칙:
- 한국어로 답변하되, 장비명·기술 용어는 원어를 병기하세요.
- 답변 길이: 3~5문단 또는 번호 목록.
- 확신이 없으면 "현장 상황에 따라 다릅니다"라고 솔직하게 말하세요.`

  const userContent = sourceBlock
    ? `질문: ${userQuery}\n\n아래 검색 결과를 참고해 답변하세요:\n\n${sourceBlock}`
    : `질문: ${userQuery}`

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       'llama-3.3-70b-versatile',
        messages:    [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userContent },
        ],
        temperature: intent === 'recommend' ? 0.2 : 0.4,
        max_tokens:  1200,
      }),
      signal: AbortSignal.timeout(18000),
    })
    if (!res.ok) return ''
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content?.trim() ?? ''
  } catch {
    return ''
  }
}

// ── 트랙 요약 (참고자료용) ─────────────────────────────────────────────────
async function synthesizeTrack(
  apiKey:    string,
  userQuery: string,
  sources:   Array<{ url: string; title: string; snippet: string }>,
  trackType: 'official' | 'community'
): Promise<string> {
  if (!apiKey || sources.length === 0) return ''

  const sourceBlock = sources
    .map((s, i) => `[출처${i + 1}] ${s.title}\nURL: ${s.url}\n내용: ${s.snippet}`)
    .join('\n\n---\n\n')

  const prompt = trackType === 'official'
    ? `아래 공식 문서에서 "${userQuery}"와 관련된 핵심 스펙·설정 정보만 간략히 요약하세요. 출처 번호 인용 필수. 3문장 이내. 한국어.`
    : `아래 커뮤니티 글에서 "${userQuery}"와 관련된 현장 팁만 간략히 요약하세요. 출처 번호 인용 필수. 3문장 이내. 한국어.`

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       'llama-3.3-70b-versatile',
        messages:    [
          { role: 'system', content: prompt },
          { role: 'user',   content: `출처:\n${sourceBlock}` },
        ],
        temperature: 0.2,
        max_tokens:  400,
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return ''
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content?.trim() ?? ''
  } catch {
    return ''
  }
}

// ── 메인 핸들러 ───────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' })

  const { query } = req.body as { query?: string }
  if (!query?.trim()) return res.status(400).json({ error: '질문을 입력하세요.' })

  const GROQ_KEY   = process.env.GROQ_API_KEY  ?? ''
  const TAVILY_KEY = process.env.TAVILY_API_KEY ?? ''

  // ── 의도 감지 + 정밀 검색어 생성 ────────────────────────────────────────
  const intent  = detectIntent(query)
  const queries = buildSearchQueries(query, intent)

  // ── 검색 3개 완전 병렬 (Vercel 30s 한도 대응) ───────────────────────────
  const tavilyDepth = intent === 'recommend' ? 'advanced' : 'basic'

  const [tavilyResults, ddgResults, extraResults] = await Promise.all([
    searchTavily(queries[0]!, TAVILY_KEY, tavilyDepth),
    searchDDG(queries[1] ?? queries[0]!),
    (intent === 'recommend' && queries[2] && TAVILY_KEY)
      ? searchTavily(queries[2], TAVILY_KEY, 'basic')
      : Promise.resolve([]),
  ])

  const allResults = [
    ...tavilyResults.map(r => ({ ...r, searchEngine: 'tavily' })),
    ...ddgResults.map(r => ({ ...r, searchEngine: 'ddg' })),
    ...extraResults.map(r => ({ ...r, searchEngine: 'tavily-extra' })),
  ].filter(r => r.snippet.trim().length > 0) // 빈 스니펫 제거

  // ── 소스 분류 ────────────────────────────────────────────────────────────
  const officialSources = allResults
    .filter(r => classifySource(r.url) === 'official')
    .slice(0, 4)
    .map(r => ({ url: r.url, title: r.title, domain: extractDomain(r.url), snippet: r.snippet }))

  const communitySources = allResults
    .filter(r => classifySource(r.url) === 'community')
    .slice(0, 4)
    .map(r => ({ url: r.url, title: r.title, domain: extractDomain(r.url), snippet: r.snippet }))

  // ── 전문가 답변 + 트랙 합성 병렬 ────────────────────────────────────────
  const [expertAnswer, officialAnswer, communityAnswer] = await Promise.all([
    synthesizeExpert(GROQ_KEY, query, intent, allResults.slice(0, 8)),
    synthesizeTrack(GROQ_KEY, query, officialSources, 'official'),
    synthesizeTrack(GROQ_KEY, query, communitySources, 'community'),
  ])

  const response: RagResponse = {
    query,
    expertAnswer: expertAnswer || (GROQ_KEY
      ? '답변 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.'
      : '[GROQ_API_KEY 미설정]'),
    trackA: {
      label:    '공식 매뉴얼',
      sources:  officialSources,
      answer:   officialAnswer,
      verified: officialSources.length > 0 && officialAnswer.length > 0,
    },
    trackB: {
      label:    '커뮤니티 실무 팁',
      sources:  communitySources,
      answer:   communityAnswer,
      verified: communitySources.length > 0 && communityAnswer.length > 0,
    },
    meta: {
      totalSources:     allResults.length,
      officialCount:    officialSources.length,
      communityCount:   communitySources.length,
      groqConfigured:   !!GROQ_KEY,
      tavilyConfigured: !!TAVILY_KEY,
      searchQueries:    queries,
    },
  }

  return res.status(200).json(response)
}

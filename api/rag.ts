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
  'avid.com','avid.com/pro-tools',
  'digico.biz',
  'mackie.com',
  'dbxpro.com',
  'behringer.com',
  'midas-music.com',
  'klipsch.com',
  'jblpro.com','jbl.com',
  'sennheiser.com',
  'audio-technica.com',
]

const COMMUNITY_DOMAINS = [
  'prosoundweb.com',
  'gearspace.com',
  'reddit.com/r/livesound',
  'reddit.com/r/audioengineering',
  'reddit.com/r/audio',
  'gearslutz.com',
  'mixonline.com',
  'soundonsound.com',
  'vi-control.net',
  'kvraudio.com',
  'sweetwater.com',
  'musiciansfriend.com',
  'guitarworld.com',
]

type TrackResult = {
  label: string
  sources: Array<{ url: string; title: string; domain: string; snippet: string }>
  answer: string
  verified: boolean
}

// ── DuckDuckGo 비공식 HTML 검색 ──────────────────────────────────────────
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

    // DDG HTML 파서 — 실제 구조: uddg= 파라미터로 실제 URL 인코딩
    const resultBlocks = html.split('class="links_main links_deep result__body"')
    for (let i = 1; i < resultBlocks.length && results.length < 8; i++) {
      const block = resultBlocks[i]!

      // 실제 URL: uddg= 파라미터에서 추출
      const uddgMatch   = block.match(/uddg=([^&"]+)/)
      // 제목: result__a 내 span 또는 텍스트
      const titleMatch  = block.match(/class="result__a"[^>]*>(?:<[^>]+>)*([^<]+)/)
      // 스니펫: result__snippet 이후 텍스트 노드
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([^<]*(?:<(?!\/a)[^>]*>[^<]*)*)/)

      const rawUrl = uddgMatch?.[1] ? decodeURIComponent(uddgMatch[1]) : ''
      const title  = titleMatch?.[1]?.trim().replace(/&amp;/g,'&').replace(/&quot;/g,'"') ?? ''
      const snippet = (snippetMatch?.[1] ?? '')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim().slice(0, 400)

      if (!rawUrl || !title || seen.has(rawUrl)) continue
      seen.add(rawUrl)

      const url = rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`
      results.push({ url, title, snippet })
    }

    return results
  } catch {
    return []
  }
}

// ── Tavily 검색 ───────────────────────────────────────────────────────────
async function searchTavily(query: string, apiKey: string): Promise<Array<{ url: string; title: string; snippet: string }>> {
  if (!apiKey) return []
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 6,
        include_answer: false,
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return []
    const data = await res.json() as { results?: Array<{ url: string; title: string; content: string }> }
    return (data.results ?? []).map(r => ({
      url:     r.url,
      title:   r.title,
      snippet: (r.content ?? '').slice(0, 400),
    }))
  } catch {
    return []
  }
}

// ── URL → 도메인 추출 ─────────────────────────────────────────────────────
function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') }
  catch { return url }
}

// ── 소스 분류 ─────────────────────────────────────────────────────────────
function classifySource(url: string): 'official' | 'community' | 'other' {
  const lc = url.toLowerCase()
  if (OFFICIAL_DOMAINS.some(d => lc.includes(d)))   return 'official'
  if (COMMUNITY_DOMAINS.some(d => lc.includes(d)))  return 'community'
  return 'other'
}

// ── 장비명·증상 파싱 ─────────────────────────────────────────────────────
function parseQuery(query: string): { deviceQuery: string; symptomQuery: string } {
  // 알려진 브랜드 감지
  const brands = ['yamaha','shure','qsc','allen','heath','soundcraft','roland',
                  'presonus','avid','digico','mackie','dbx','behringer','midas',
                  'sennheiser','audio-technica','jbl','klipsch','dante','waves']
  const lower  = query.toLowerCase()
  const brand  = brands.find(b => lower.includes(b)) ?? ''

  const deviceQuery   = brand
    ? `${brand} audio equipment manual site:${brand.replace('-','')}.com OR site:pro.${brand}.com`
    : `${query} audio equipment manual specifications`

  const symptomQuery = `${query} audio problem fix solution forum`
  return { deviceQuery, symptomQuery }
}

// ── Groq 합성 (할루시네이션 차단 프롬프트) ─────────────────────────────
async function synthesizeWithGroq(
  apiKey: string,
  userQuery: string,
  trackLabel: string,
  sources: Array<{ url: string; title: string; snippet: string }>,
  trackType: 'official' | 'community'
): Promise<string> {
  if (!apiKey || sources.length === 0) return ''

  const sourceBlock = sources
    .map((s, i) => `[출처${i + 1}] ${s.title}\nURL: ${s.url}\n내용: ${s.snippet}`)
    .join('\n\n---\n\n')

  const systemPrompt = trackType === 'official'
    ? `당신은 음향 장비 전문 기술 문서 분석가입니다.
아래 제공된 공식 문서 출처(${trackLabel})의 내용만 사용하여 답변하세요.
규칙:
1. 반드시 출처 URL을 "[출처N]" 형태로 인용하세요.
2. 출처에 없는 내용은 절대 생성하지 마세요.
3. 확인 불가 시 "해당 정보는 검색된 공식 문서에서 확인할 수 없습니다."라고만 출력하세요.
4. 한국어로 답변하되, 기술 용어는 원어 병기하세요.
5. 답변은 3~6문장 이내로 간결하게.`
    : `당신은 음향 현장 엔지니어 커뮤니티 정보 분석가입니다.
아래 커뮤니티 포럼·블로그 출처(${trackLabel})의 내용만 사용하여 실무 팁을 요약하세요.
규칙:
1. 반드시 출처 URL을 "[출처N]" 형태로 인용하세요.
2. 출처에 없는 내용은 절대 생성하지 마세요.
3. 확인 불가 시 "커뮤니티 검색 결과에서 관련 실무 팁을 찾을 수 없습니다."라고만 출력하세요.
4. 한국어로, 현장 실무자 관점에서 요약하세요.
5. 답변은 3~6문장 이내.`

  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system',    content: systemPrompt },
          { role: 'user',      content: `질문: ${userQuery}\n\n검색된 출처:\n${sourceBlock}` },
        ],
        temperature: 0.2,
        max_tokens:  600,
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error('Groq error:', err)
      return ''
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content?.trim() ?? ''
  } catch (e) {
    console.error('Groq fetch failed:', e)
    return ''
  }
}

// ── 메인 핸들러 ───────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' })

  const { query } = req.body as { query?: string }
  if (!query?.trim()) return res.status(400).json({ error: '질문을 입력하세요.' })

  const GROQ_KEY   = process.env.GROQ_API_KEY   ?? ''
  const TAVILY_KEY = process.env.TAVILY_API_KEY  ?? ''

  // ── 병렬 검색 ──────────────────────────────────────────────────────────
  const { deviceQuery, symptomQuery } = parseQuery(query)

  const [ddgResults, tavilyResults] = await Promise.all([
    searchDDG(`${query} official manual documentation specifications`),
    searchTavily(`${query} ${symptomQuery}`, TAVILY_KEY),
  ])

  // ── 소스 분류 ──────────────────────────────────────────────────────────
  const allResults = [
    ...ddgResults.map(r => ({ ...r, searchEngine: 'ddg' })),
    ...tavilyResults.map(r => ({ ...r, searchEngine: 'tavily' })),
  ]

  const officialSources = allResults
    .filter(r => classifySource(r.url) === 'official')
    .slice(0, 4)
    .map(r => ({ url: r.url, title: r.title, domain: extractDomain(r.url), snippet: r.snippet }))

  const communitySources = allResults
    .filter(r => classifySource(r.url) === 'community')
    .slice(0, 4)
    .map(r => ({ url: r.url, title: r.title, domain: extractDomain(r.url), snippet: r.snippet }))

  // 공식 소스 부족 시: DDG official 도메인 타깃 재검색
  if (officialSources.length === 0) {
    const retry = await searchDDG(deviceQuery)
    retry.forEach(r => {
      if (classifySource(r.url) === 'official' && officialSources.length < 4) {
        officialSources.push({ url: r.url, title: r.title, domain: extractDomain(r.url), snippet: r.snippet })
      }
    })
  }

  // ── Groq 병렬 합성 ─────────────────────────────────────────────────────
  const [officialAnswer, communityAnswer] = await Promise.all([
    synthesizeWithGroq(GROQ_KEY, query, '공식 매뉴얼', officialSources, 'official'),
    synthesizeWithGroq(GROQ_KEY, query, '커뮤니티 실무 팁', communitySources, 'community'),
  ])

  const trackA: TrackResult = {
    label:    '공식 매뉴얼',
    sources:  officialSources,
    answer:   officialAnswer  || (GROQ_KEY ? '공식 문서를 찾을 수 없습니다. 제조사 웹사이트를 직접 확인하세요.' : '[GROQ_API_KEY 미설정 — .env.local 확인]'),
    verified: officialSources.length > 0 && officialAnswer.length > 0,
  }

  const trackB: TrackResult = {
    label:    '커뮤니티 실무 팁',
    sources:  communitySources,
    answer:   communityAnswer || (GROQ_KEY ? '관련 커뮤니티 논의를 찾을 수 없습니다.' : '[GROQ_API_KEY 미설정 — .env.local 확인]'),
    verified: communitySources.length > 0 && communityAnswer.length > 0,
  }

  return res.status(200).json({
    query,
    trackA,
    trackB,
    meta: {
      totalSources: allResults.length,
      officialCount: officialSources.length,
      communityCount: communitySources.length,
      groqConfigured: !!GROQ_KEY,
      tavilyConfigured: !!TAVILY_KEY,
    }
  })
}

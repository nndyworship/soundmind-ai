/**
 * 로컬 개발용 API 서버 (Node.js 내장 http 모듈, 의존성 없음)
 * 실행: node engine/dev-server.mjs
 * Vite가 /api/* 요청을 이 서버로 프록시함
 */
import http from 'http'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 3001

// .env.local 파싱
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '..', '.env.local')
    const lines = readFileSync(envPath, 'utf8').split('\n')
    lines.forEach(line => {
      const [k, ...v] = line.split('=')
      if (k && v.length) process.env[k.trim()] = v.join('=').trim()
    })
    console.log('✓ .env.local 로드 완료')
  } catch {
    console.log('⚠ .env.local 없음 — API 키 없이 실행 (결과 제한됨)')
  }
}

// RAG 핸들러 동적 import (Vercel 함수와 동일 로직)
async function handleRag(body) {
  const GROQ_KEY   = process.env.GROQ_API_KEY   ?? ''
  const TAVILY_KEY = process.env.TAVILY_API_KEY  ?? ''
  const { query }  = body

  if (!query?.trim()) return { error: '질문을 입력하세요.' }

  // DuckDuckGo 검색
  async function searchDDG(q) {
    try {
      const res = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
        { headers: { 'User-Agent': 'Mozilla/5.0 Chrome/125.0.0.0' }, signal: AbortSignal.timeout(8000) }
      )
      const html = await res.text()
      const results = []
      const seen = new Set()
      const blocks = html.split('class="links_main links_deep result__body"')
      for (let i = 1; i < blocks.length && results.length < 8; i++) {
        const b = blocks[i]
        const uddgM = b.match(/uddg=([^&"]+)/)
        const titM  = b.match(/class="result__a"[^>]*>(?:<[^>]+>)*([^<]+)/)
        const snpM  = b.match(/class="result__snippet"[^>]*>([^<]*(?:<(?!\/a)[^>]*>[^<]*)*)/)
        const rawUrl = uddgM?.[1] ? decodeURIComponent(uddgM[1]) : ''
        const title  = titM?.[1]?.trim().replace(/&amp;/g,'&') ?? ''
        if (!rawUrl || !title || seen.has(rawUrl)) continue
        seen.add(rawUrl)
        results.push({
          url:     rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`,
          title,
          snippet: (snpM?.[1] ?? '').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0, 400),
        })
      }
      return results
    } catch (e) { console.error('DDG error:', e.message); return [] }
  }

  // Tavily 검색
  async function searchTavily(q) {
    if (!TAVILY_KEY) return []
    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: TAVILY_KEY, query: q, max_results: 6 }),
        signal: AbortSignal.timeout(10000),
      })
      const data = await res.json()
      return (data.results ?? []).map(r => ({ url: r.url, title: r.title, snippet: (r.content ?? '').slice(0, 400) }))
    } catch (e) { console.error('Tavily error:', e.message); return [] }
  }

  const OFFICIAL_D  = ['pro.yamaha.com','usa.yamaha.com','yamaha.com','pubs.shure.com','shure.com','qsc.com','allen-heath.com','soundcraft.com','roland.com','presonus.com','avid.com','digico.biz','mackie.com','dbxpro.com','behringer.com','midas-music.com']
  const COMMUNITY_D = ['prosoundweb.com','gearspace.com','reddit.com','gearslutz.com','mixonline.com','soundonsound.com','vi-control.net']

  const classify = url => {
    const lc = url.toLowerCase()
    if (OFFICIAL_D.some(d  => lc.includes(d)))  return 'official'
    if (COMMUNITY_D.some(d => lc.includes(d)))  return 'community'
    return 'other'
  }
  const domain = url => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

  const [ddg, tav] = await Promise.all([
    searchDDG(`${query} audio manual official documentation`),
    searchTavily(`${query} audio problem solution forum`),
  ])

  const all = [...ddg, ...tav]
  const officialSrc  = all.filter(r => classify(r.url) === 'official').slice(0,4).map(r => ({ ...r, domain: domain(r.url) }))
  const communitySrc = all.filter(r => classify(r.url) === 'community').slice(0,4).map(r => ({ ...r, domain: domain(r.url) }))

  // Groq 합성
  async function groq(sources, type) {
    if (!GROQ_KEY || !sources.length) return ''
    const srcBlock = sources.map((s,i) => `[출처${i+1}] ${s.title}\nURL: ${s.url}\n내용: ${s.snippet}`).join('\n---\n')
    const sys = type === 'official'
      ? `음향 장비 공식 문서 분석가. 출처에 있는 내용만 한국어로 답변. 출처 없으면 "공식 문서에서 확인 불가"만 출력. 반드시 [출처N] 인용.`
      : `음향 커뮤니티 정보 분석가. 출처에 있는 실무 팁만 한국어로 요약. 출처 없으면 "커뮤니티에서 관련 내용 미발견"만 출력. 반드시 [출처N] 인용.`
    try {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROQ_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role:'system', content: sys },{ role:'user', content:`질문: ${query}\n\n출처:\n${srcBlock}` }],
          temperature: 0.2, max_tokens: 600,
        }),
        signal: AbortSignal.timeout(20000),
      })
      const d = await r.json()
      return d.choices?.[0]?.message?.content?.trim() ?? ''
    } catch(e) { console.error('Groq error:', e.message); return '' }
  }

  const [ansA, ansB] = await Promise.all([groq(officialSrc, 'official'), groq(communitySrc, 'community')])

  return {
    query,
    trackA: { label:'공식 매뉴얼', sources:officialSrc,  answer: ansA || (!GROQ_KEY ? '[GROQ_API_KEY 미설정]' : '공식 문서 미발견'), verified: officialSrc.length>0 && !!ansA },
    trackB: { label:'커뮤니티 실무 팁', sources:communitySrc, answer: ansB || (!GROQ_KEY ? '[GROQ_API_KEY 미설정]' : '커뮤니티 자료 미발견'), verified: communitySrc.length>0 && !!ansB },
    meta: { totalSources: all.length, officialCount: officialSrc.length, communityCount: communitySrc.length, groqConfigured: !!GROQ_KEY, tavilyConfigured: !!TAVILY_KEY }
  }
}

loadEnv()

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return }

  if (req.url === '/api/rag' && req.method === 'POST') {
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body)
        console.log(`[RAG] 쿼리: "${parsed.query}"`)
        const result = await handleRag(parsed)
        console.log(`[RAG] 완료 — 공식:${result.meta?.officialCount ?? 0}건, 커뮤니티:${result.meta?.communityCount ?? 0}건`)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(result))
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: e.message }))
      }
    })
    return
  }

  res.writeHead(404); res.end('Not Found')
})

server.listen(PORT, () => {
  console.log(`\n🎛  SoundMind Dev API Server`)
  console.log(`   http://localhost:${PORT}/api/rag\n`)
})

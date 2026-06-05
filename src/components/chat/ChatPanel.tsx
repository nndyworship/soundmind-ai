import { useState, useRef, useEffect } from 'react'

// ── 타입 ──────────────────────────────────────────────────────────────────
interface Source { url: string; title: string; domain: string; snippet: string }
interface TrackResult { label: string; sources: Source[]; answer: string; verified: boolean }
interface RagResponse {
  query: string
  trackA: TrackResult
  trackB: TrackResult
  meta: { totalSources: number; officialCount: number; communityCount: number; groqConfigured: boolean; tavilyConfigured: boolean }
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  query?: string
  response?: RagResponse
  error?: string
  ts: number
}

// 장비 빠른 입력 예시
const QUICK_QUERIES = [
  'Yamaha CL5 채널 뮤트 문제',
  'Shure SM58 하울링 원인',
  'QSC K12.2 노이즈 해결',
  'Allen & Heath SQ5 딜레이 설정',
  '라이브 보컬 피드백 제거',
  'Yamaha QL1 Mix Bus 설정',
]

export default function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input,    setInput]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef  = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendQuery(q: string) {
    const query = q.trim()
    if (!query || loading) return

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', query, ts: Date.now() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      const data: RagResponse = await res.json()

      const assistantMsg: Message = {
        id: crypto.randomUUID(), role: 'assistant', response: data, ts: Date.now(),
      }
      setMessages(prev => [...prev, assistantMsg])
    } catch (e) {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(), role: 'assistant', error: '서버 연결 실패. dev-server.mjs 실행 여부 확인.', ts: Date.now(),
      }])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendQuery(input) }
  }

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 600 }}>

      {/* 헤더 */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 20px', borderBottom:'1px solid var(--border)' }}>
        <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:13, fontWeight:700, letterSpacing:2, color:'#0a84ff' }}>
          AI SEARCH — DUAL-TRACK RAG
        </span>
        <div style={{ display:'flex', gap:8 }}>
          <Badge label="Track A" color="#00ff88" desc="공식 매뉴얼" />
          <Badge label="Track B" color="#ffb300" desc="커뮤니티 팁" />
        </div>
      </div>

      {/* 메시지 영역 */}
      <div style={{ flex:1, overflowY:'auto', padding:'16px 20px', display:'flex', flexDirection:'column', gap:16 }}>
        {messages.length === 0 && (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', flex:1, gap:20, paddingTop:40 }}>
            <div style={{ fontFamily:'JetBrains Mono, monospace', fontSize:13, color:'#333', letterSpacing:2, textAlign:'center' }}>
              장비명 + 증상을 입력하면<br/>
              <span style={{ color:'#00ff88' }}>공식 매뉴얼</span>과 <span style={{ color:'#ffb300' }}>커뮤니티 팁</span>을 분리 검색합니다
            </div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8, justifyContent:'center', maxWidth:600 }}>
              {QUICK_QUERIES.map(q => (
                <button key={q} onClick={() => sendQuery(q)} style={{
                  padding:'8px 14px', border:'1px solid #1f1f1f', borderRadius:6,
                  background:'transparent', color:'#555', cursor:'pointer',
                  fontFamily:'monospace', fontSize:12,
                  transition:'border-color 0.2s, color 0.2s',
                }}
                  onMouseEnter={e => { (e.target as HTMLButtonElement).style.borderColor='#0a84ff'; (e.target as HTMLButtonElement).style.color='#0a84ff' }}
                  onMouseLeave={e => { (e.target as HTMLButtonElement).style.borderColor='#1f1f1f'; (e.target as HTMLButtonElement).style.color='#555' }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id}>
            {msg.role === 'user' ? (
              <UserBubble query={msg.query!} />
            ) : msg.error ? (
              <ErrorBubble msg={msg.error} />
            ) : (
              <AssistantBubble response={msg.response!} />
            )}
          </div>
        ))}

        {loading && <LoadingBubble />}
        <div ref={bottomRef} />
      </div>

      {/* 입력창 */}
      <div style={{ borderTop:'1px solid var(--border)', padding:'14px 16px', display:'flex', gap:12, alignItems:'flex-end' }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="장비명 + 증상을 입력하세요 (Enter 전송 / Shift+Enter 줄바꿈)"
          disabled={loading}
          rows={2}
          style={{
            flex:1, background:'#0a0a0a', border:'1px solid #1f1f1f', borderRadius:8,
            color:'var(--text-primary)', fontFamily:'monospace', fontSize:13,
            padding:'10px 14px', resize:'none', outline:'none',
            lineHeight:1.6, minHeight:56,
          }}
        />
        <button
          onClick={() => sendQuery(input)}
          disabled={loading || !input.trim()}
          style={{
            minHeight:56, minWidth:80, padding:'0 20px',
            border:'1px solid #0a84ff', borderRadius:8,
            background: loading || !input.trim() ? 'transparent' : '#0a84ff18',
            color: loading || !input.trim() ? '#333' : '#0a84ff',
            fontFamily:'JetBrains Mono, monospace', fontSize:12, fontWeight:700,
            cursor: loading || !input.trim() ? 'default' : 'pointer', letterSpacing:1,
          }}
        >
          {loading ? '...' : '검색'}
        </button>
      </div>
    </div>
  )
}

// ── 서브 컴포넌트 ─────────────────────────────────────────────────────────

function Badge({ label, color, desc }: { label: string; color: string; desc: string }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 10px', border:`1px solid ${color}33`, borderRadius:6, background:`${color}0a` }}>
      <div style={{ width:6, height:6, borderRadius:'50%', background:color }} />
      <span style={{ fontSize:10, fontFamily:'monospace', color, letterSpacing:1 }}>{label}</span>
      <span style={{ fontSize:10, color:'#444' }}>{desc}</span>
    </div>
  )
}

function UserBubble({ query }: { query: string }) {
  return (
    <div style={{ display:'flex', justifyContent:'flex-end' }}>
      <div style={{ maxWidth:'75%', background:'#0a84ff18', border:'1px solid #0a84ff33', borderRadius:'12px 12px 2px 12px', padding:'10px 14px' }}>
        <div style={{ fontSize:13, fontFamily:'monospace', color:'var(--text-primary)', lineHeight:1.6 }}>{query}</div>
      </div>
    </div>
  )
}

function ErrorBubble({ msg }: { msg: string }) {
  return (
    <div style={{ background:'#1a0000', border:'1px solid #ff3b3066', borderRadius:8, padding:'12px 16px', color:'#ff3b30', fontFamily:'monospace', fontSize:12 }}>
      {msg}
    </div>
  )
}

function LoadingBubble() {
  return (
    <div style={{ display:'flex', gap:12, alignItems:'center', padding:'12px 16px', background:'var(--bg-elevated)', border:'1px solid var(--border)', borderRadius:8 }}>
      <div style={{ display:'flex', gap:6 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{ width:6, height:6, borderRadius:'50%', background:'#0a84ff',
            animation:'bounce 1.2s ease-in-out infinite',
            animationDelay:`${i*0.2}s` }} />
        ))}
      </div>
      <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:11, color:'#555', letterSpacing:1 }}>
        공식 문서 + 커뮤니티 병렬 검색 중...
      </span>
      <style>{`
        @keyframes bounce {
          0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)}
        }
      `}</style>
    </div>
  )
}

function AssistantBubble({ response }: { response: RagResponse }) {
  const { trackA, trackB, meta } = response

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

      {/* 메타 배지 */}
      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
        <MetaBadge label={`총 ${meta.totalSources}개 소스`} color='#555' />
        <MetaBadge label={`공식 ${meta.officialCount}건`}    color='#00ff88' />
        <MetaBadge label={`커뮤니티 ${meta.communityCount}건`} color='#ffb300' />
        {!meta.groqConfigured  && <MetaBadge label="⚠ GROQ_KEY 미설정"   color='#ff3b30' />}
        {!meta.tavilyConfigured && <MetaBadge label="TAVILY 미설정(DDG 전용)" color='#555' />}
      </div>

      {/* Track A — 공식 매뉴얼 */}
      <TrackCard track={trackA} trackColor="#00ff88" icon="📘" />

      {/* Track B — 커뮤니티 */}
      <TrackCard track={trackB} trackColor="#ffb300" icon="🔧" />
    </div>
  )
}

function TrackCard({ track, trackColor, icon }: { track: TrackResult; trackColor: string; icon: string }) {
  const [open, setOpen] = useState(true)

  return (
    <div style={{ background:'var(--bg-elevated)', border:`1px solid ${trackColor}33`, borderRadius:8, overflow:'hidden' }}>
      {/* 트랙 헤더 */}
      <div
        onClick={() => setOpen(p => !p)}
        style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', cursor:'pointer', borderBottom: open ? `1px solid ${trackColor}22` : 'none' }}
      >
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span>{icon}</span>
          <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:12, fontWeight:700, color:trackColor, letterSpacing:1 }}>
            {track.label}
          </span>
          {track.verified
            ? <span style={{ fontSize:10, color:'#00ff88', fontFamily:'monospace' }}>✓ 검증됨</span>
            : <span style={{ fontSize:10, color:'#ff3b30', fontFamily:'monospace' }}>⚠ 미검증</span>
          }
        </div>
        <span style={{ color:'#333', fontSize:12 }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:10 }}>
          {/* 답변 */}
          <div style={{ fontSize:13, fontFamily:'monospace', color:'var(--text-primary)', lineHeight:1.8, whiteSpace:'pre-wrap' }}>
            {track.answer}
          </div>

          {/* 소스 카드들 */}
          {track.sources.length > 0 && (
            <div>
              <div style={{ fontSize:10, letterSpacing:1, color:'#444', fontFamily:'monospace', marginBottom:6 }}>출처</div>
              <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                {track.sources.map((src, i) => (
                  <SourceCard key={i} src={src} color={trackColor} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SourceCard({ src, color }: { src: Source; color: string }) {
  return (
    <a href={src.url} target="_blank" rel="noopener noreferrer"
      style={{ display:'block', background:'#0a0a0a', border:'1px solid #1a1a1a', borderRadius:6, padding:'8px 10px', textDecoration:'none', transition:'border-color 0.15s' }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = color + '66')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = '#1a1a1a')}
    >
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <span style={{ fontFamily:'monospace', fontSize:11, color, fontWeight:700 }}>{src.domain}</span>
        <span style={{ fontSize:9, color:'#333', fontFamily:'monospace' }}>↗</span>
      </div>
      <div style={{ fontSize:12, color:'var(--text-secondary)', fontFamily:'monospace', marginBottom:4, lineHeight:1.4 }}>{src.title}</div>
      {src.snippet && (
        <div style={{ fontSize:11, color:'#444', fontFamily:'monospace', lineHeight:1.5 }}>
          {src.snippet.slice(0, 180)}{src.snippet.length > 180 ? '…' : ''}
        </div>
      )}
    </a>
  )
}

function MetaBadge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ padding:'3px 8px', border:`1px solid ${color}44`, borderRadius:4, fontSize:10, color, fontFamily:'monospace' }}>
      {label}
    </span>
  )
}

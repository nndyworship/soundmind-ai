import { useState, useRef, useEffect } from 'react'
import TrackOfficial  from './TrackOfficial'
import TrackCommunity from './TrackCommunity'
import { parseGuardedText } from '../../lib/hallucinationGuard'

// ── 타입 ──────────────────────────────────────────────────────────────────
interface Source { url: string; title: string; domain: string; snippet: string }
interface TrackResult { label: string; sources: Source[]; answer: string; verified: boolean }
interface RagResponse {
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
  }
}

interface Message {
  id:        string
  role:      'user' | 'assistant'
  query?:    string
  response?: RagResponse
  error?:    string
  ts:        number
}

const QUICK_QUERIES = [
  'Yamaha CL5 채널 뮤트 문제',
  'Shure SM58 하울링 원인',
  'QSC K12.2 노이즈 해결',
  'Allen & Heath SQ5 딜레이 설정',
  '라이브 보컬 피드백 제거',
  'Yamaha QL1 Mix Bus 설정',
]

// ── 메인 패널 ─────────────────────────────────────────────────────────────
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

    setMessages(prev => [...prev, {
      id: crypto.randomUUID(), role: 'user', query, ts: Date.now(),
    }])
    setInput('')
    setLoading(true)

    try {
      const res  = await fetch('/api/rag', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query }),
      })
      const data = await res.json() as RagResponse
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(), role: 'assistant', response: data, ts: Date.now(),
      }])
    } catch {
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(), role: 'assistant', error: '서버 연결 실패.', ts: Date.now(),
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
    <div style={{
      background:    'var(--bg-surface)',
      border:        '1px solid var(--border)',
      borderRadius:  12,
      overflow:      'hidden',
      display:       'flex',
      flexDirection: 'column',
      minHeight:     600,
      fontFamily:    "'Inter', system-ui, sans-serif",
    }}>

      {/* 헤더 */}
      <div style={{
        display:        'flex',
        justifyContent: 'space-between',
        alignItems:     'center',
        padding:        '14px 20px',
        borderBottom:   '1px solid var(--border)',
      }}>
        <div>
          <span style={{
            fontFamily:    "'JetBrains Mono', monospace",
            fontSize:      13,
            fontWeight:    700,
            letterSpacing: 2,
            color:         'var(--accent-blue)',
          }}>
            SOUNDMIND AI
          </span>
          <span style={{
            fontSize:   11,
            color:      'var(--text-muted)',
            marginLeft: 10,
          }}>
            20년 현장 엔지니어 관점
          </span>
        </div>
      </div>

      {/* 메시지 영역 */}
      <div style={{
        flex:          1,
        overflowY:     'auto',
        padding:       '16px 20px',
        display:       'flex',
        flexDirection: 'column',
        gap:           16,
      }}>
        {messages.length === 0 && (
          <EmptyState onSelect={sendQuery} />
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

      {/* 입력창 — 터치 타깃 최소 56px (SPEC) */}
      <div style={{
        borderTop:  '1px solid var(--border)',
        padding:    '14px 16px',
        display:    'flex',
        gap:        12,
        alignItems: 'flex-end',
      }}>
        <textarea
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="장비명 + 증상 또는 셋업 질문 (Enter 전송 / Shift+Enter 줄바꿈)"
          disabled={loading}
          rows={2}
          style={{
            flex:        1,
            background:  'var(--bg-primary)',
            border:      '1px solid var(--border)',
            borderRadius: 8,
            color:       'var(--text-primary)',
            fontFamily:  "'Inter', system-ui, sans-serif",
            fontSize:    13,
            padding:     '10px 14px',
            resize:      'none',
            outline:     'none',
            lineHeight:  1.6,
            minHeight:   56,
          }}
        />
        <button
          onClick={() => sendQuery(input)}
          disabled={loading || !input.trim()}
          style={{
            minHeight:   56,
            minWidth:    80,
            padding:     '0 20px',
            border:      '1px solid var(--accent-blue)',
            borderRadius: 8,
            background:  loading || !input.trim() ? 'transparent' : 'var(--accent-blue-10)',
            color:       loading || !input.trim() ? 'var(--text-muted)' : 'var(--accent-blue)',
            fontFamily:  "'JetBrains Mono', monospace",
            fontSize:    12,
            fontWeight:  700,
            cursor:      loading || !input.trim() ? 'default' : 'pointer',
            letterSpacing: 1,
          }}
        >
          {loading ? '...' : '전송'}
        </button>
      </div>
    </div>
  )
}

// ── 서브 컴포넌트 ─────────────────────────────────────────────────────────

function EmptyState({ onSelect }: { onSelect: (q: string) => void }) {
  return (
    <div style={{
      display:        'flex',
      flexDirection:  'column',
      alignItems:     'center',
      justifyContent: 'center',
      flex:           1,
      gap:            20,
      paddingTop:     40,
    }}>
      <div style={{
        fontFamily:    "'JetBrains Mono', monospace",
        fontSize:      13,
        color:         'var(--text-muted)',
        letterSpacing: 2,
        textAlign:     'center',
      }}>
        장비명 + 증상을 입력하세요
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 600 }}>
        {QUICK_QUERIES.map(q => (
          <QuickButton key={q} label={q} onClick={() => onSelect(q)} />
        ))}
      </div>
    </div>
  )
}

function QuickButton({ label, onClick }: { label: string; onClick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding:      '8px 14px',
        border:       `1px solid ${hover ? 'var(--accent-blue)' : 'var(--border)'}`,
        borderRadius: 6,
        background:   'transparent',
        color:        hover ? 'var(--accent-blue)' : 'var(--text-secondary)',
        cursor:       'pointer',
        fontFamily:   "'Inter', system-ui, sans-serif",
        fontSize:     12,
        transition:   'border-color 0.2s, color 0.2s',
        minHeight:    36,
      }}
    >
      {label}
    </button>
  )
}

function UserBubble({ query }: { query: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{
        maxWidth:     '75%',
        background:   'var(--accent-blue-10)',
        border:       '1px solid var(--accent-blue-20)',
        borderRadius: '12px 12px 2px 12px',
        padding:      '10px 14px',
      }}>
        <div style={{
          fontSize:   13,
          color:      'var(--text-primary)',
          lineHeight: 1.6,
        }}>
          {query}
        </div>
      </div>
    </div>
  )
}

function ErrorBubble({ msg }: { msg: string }) {
  return (
    <div style={{
      background:   'var(--accent-red-10)',
      border:       '1px solid var(--accent-red)',
      borderRadius: 8,
      padding:      '12px 16px',
      color:        'var(--accent-red)',
      fontFamily:   "'JetBrains Mono', monospace",
      fontSize:     12,
    }}>
      {msg}
    </div>
  )
}

function LoadingBubble() {
  return (
    <div style={{
      display:      'flex',
      gap:          12,
      alignItems:   'center',
      padding:      '12px 16px',
      background:   'var(--bg-elevated)',
      border:       '1px solid var(--border)',
      borderRadius: 8,
    }}>
      <div style={{ display: 'flex', gap: 6 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width:            6,
            height:           6,
            borderRadius:     '50%',
            background:       'var(--accent-blue)',
            animation:        'bounce 1.2s ease-in-out infinite',
            animationDelay:   `${i * 0.2}s`,
          }} />
        ))}
      </div>
      <span style={{
        fontFamily:    "'JetBrains Mono', monospace",
        fontSize:      11,
        color:         'var(--text-muted)',
        letterSpacing: 1,
      }}>
        분석 중...
      </span>
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}`}</style>
    </div>
  )
}

// ── 전문가 답변 버블 ──────────────────────────────────────────────────────
function AssistantBubble({ response }: { response: RagResponse }) {
  const { expertAnswer, trackA, trackB, meta } = response

  // SPEC: hallucinationGuard를 통과한 후 렌더링
  const guardedLines = parseGuardedText(expertAnswer)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* 메인: 전문가 답변 */}
      <div style={{
        background:   'var(--bg-elevated)',
        border:       '1px solid var(--accent-blue-20)',
        borderRadius: 8,
        padding:      '16px 18px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-blue)',
          }} />
          <span style={{
            fontFamily:    "'JetBrains Mono', monospace",
            fontSize:      11,
            color:         'var(--accent-blue)',
            fontWeight:    700,
            letterSpacing: 1,
          }}>
            ENGINEER
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            20년 현장 경험 기반
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {guardedLines.map((line, i) => (
            <div key={i} style={{
              fontSize:   13,
              lineHeight: 1.9,
              whiteSpace: 'pre-wrap',
              color:      'var(--text-primary)',
            }}>
              {line.text}
            </div>
          ))}
        </div>
      </div>

      {/* 참고자료: 소스 있을 때만 노출 (SPEC 준수) */}
      <TrackOfficial
        sources={trackA.sources}
        answer={trackA.answer}
        verified={trackA.verified}
      />
      <TrackCommunity
        sources={trackB.sources}
        answer={trackB.answer}
        verified={trackB.verified}
      />

      {!meta.groqConfigured && (
        <div style={{ fontSize: 10, color: 'var(--accent-red)', fontFamily: "'JetBrains Mono', monospace", padding: '4px 8px' }}>
          ⚠ GROQ_API_KEY 미설정
        </div>
      )}
    </div>
  )
}

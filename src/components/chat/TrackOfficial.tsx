import { useState } from 'react'

interface Source { url: string; title: string; domain: string; snippet: string }

interface TrackOfficialProps {
  sources: Source[]
  answer:  string
  verified: boolean
}

export default function TrackOfficial({ sources, answer, verified }: TrackOfficialProps) {
  const [open, setOpen] = useState(false)

  if (sources.length === 0) return null

  return (
    <div style={{
      border: '1px solid var(--accent-green-20)',
      borderRadius: 8,
      overflow: 'hidden',
      fontFamily: "'Inter', system-ui, sans-serif",
    }}>
      <button
        onClick={() => setOpen(p => !p)}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 14px',
          background: open ? 'var(--accent-green-10)' : 'transparent',
          border: 'none',
          cursor: 'pointer',
          minHeight: 44,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13 }}>📘</span>
          <span style={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 11,
            color: 'var(--accent-green)',
            fontWeight: 700,
            letterSpacing: 1,
          }}>
            공식 매뉴얼
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>
            출처 {sources.length}건
          </span>
          {verified && (
            <span style={{ fontSize: 10, color: 'var(--accent-green)', fontFamily: "'JetBrains Mono', monospace" }}>
              ✓
            </span>
          )}
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--accent-green-20)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          {answer && (
            <p style={{
              fontSize: 12,
              color: 'var(--text-secondary)',
              lineHeight: 1.7,
              whiteSpace: 'pre-wrap',
              margin: '0 0 4px',
              fontFamily: "'Inter', system-ui, sans-serif",
            }}>
              {answer}
            </p>
          )}
          {sources.map((src, i) => (
            <SourceCard key={i} src={src} accentColor="var(--accent-green)" borderAlpha="var(--accent-green-20)" />
          ))}
        </div>
      )}
    </div>
  )
}

function SourceCard({ src, accentColor, borderAlpha }: { src: Source; accentColor: string; borderAlpha: string }) {
  return (
    <a
      href={src.url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: 'block',
        background: 'var(--bg-primary)',
        border: `1px solid var(--border)`,
        borderRadius: 6,
        padding: '8px 10px',
        textDecoration: 'none',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = accentColor)}
      onMouseLeave={e => (e.currentTarget.style.borderColor = borderAlpha)}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
        <span style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 11,
          color: accentColor,
          fontWeight: 700,
        }}>
          {src.domain}
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: "'JetBrains Mono', monospace" }}>↗</span>
      </div>
      <div style={{
        fontSize: 11,
        color: 'var(--text-secondary)',
        fontFamily: "'Inter', system-ui, sans-serif",
        lineHeight: 1.4,
      }}>
        {src.title}
      </div>
      {src.snippet && (
        <div style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          fontFamily: "'Inter', system-ui, sans-serif",
          lineHeight: 1.5,
          marginTop: 3,
        }}>
          {src.snippet.slice(0, 160)}{src.snippet.length > 160 ? '…' : ''}
        </div>
      )}
    </a>
  )
}

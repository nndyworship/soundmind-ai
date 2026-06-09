import { useState } from 'react'
import './index.css'
import HowlingDetector  from './components/utils/HowlingDetector'
import EQMaskingGuide   from './components/utils/EQMaskingGuide'
import CompressorGuide  from './components/utils/CompressorGuide'
import ClarityM         from './components/clarity/ClarityM'
import LiveConsole      from './components/console/LiveConsole'

type TabId = 'howling' | 'eq' | 'comp' | 'clarity'

const TABS: { id: TabId; label: string; done: boolean }[] = [
  { id: 'howling', label: 'HOWLING',    done: true  },
  { id: 'eq',      label: 'EQ GUIDE',   done: true  },
  { id: 'comp',    label: 'COMP GUIDE', done: true  },
  { id: 'clarity', label: 'CLARITY M',  done: true  },
]

export default function App() {
  const [tab, setTab] = useState<TabId>('howling')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary)', padding: '0 0 40px' }}>

      {/* 헤더 */}
      <div style={{
        borderBottom: '1px solid var(--border)',
        padding: '16px 24px',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                      background: 'radial-gradient(circle, #00ff88 0%, #003322 100%)' }} />
        <div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 15,
                        fontWeight: 700, letterSpacing: 2, color: 'var(--accent-green)' }}>
            SOUNDMIND AI
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)',
                        fontFamily: 'monospace', letterSpacing: 1 }}>
            현장 맞춤형 음향 만능 AI 대시보드
          </div>
        </div>
      </div>

      {/* 탭 */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 24px', gap: 0 }}>
        {TABS.map(t => (
          <div key={t.id} onClick={() => t.done && setTab(t.id)} style={{
            padding: '12px 20px', fontSize: 11,
            fontFamily: 'JetBrains Mono, monospace', letterSpacing: 1.5, fontWeight: 700,
            cursor: t.done ? 'pointer' : 'default',
            color: tab === t.id ? 'var(--accent-green)' : t.done ? 'var(--text-secondary)' : 'var(--text-muted)',
            borderBottom: tab === t.id ? '2px solid var(--accent-green)' : '2px solid transparent',
            marginBottom: -1,
          }}>
            {t.label}{!t.done && <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.4 }}>WIP</span>}
          </div>
        ))}
      </div>

      {/* 컨텐츠 */}
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px' }}>
        {tab === 'howling'  && <HowlingDetector />}
        {tab === 'eq'       && <EQMaskingGuide />}
        {tab === 'comp'     && <CompressorGuide />}
        {tab === 'clarity'  && <ClarityM />}
      </div>

      {/* 전역 Self-Healing Console — 모든 탭에서 플로팅 표시 */}
      <LiveConsole />
    </div>
  )
}

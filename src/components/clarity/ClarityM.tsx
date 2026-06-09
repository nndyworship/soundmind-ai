/**
 * ClarityM.tsx — TC Electronic Clarity M 스타일 마스터 미터링 패널
 *
 * 뷰:
 *   GONIO — Lissajous 위상 스코프 + 레벨 미터 + 상관계수
 *   RTA   — 1/3 옥타브 실시간 주파수 분석기 (ISO 31밴드, Clarity M 스펙)
 *   SCOPE — LUFS 스크롤링 히스토그램
 *
 * iPad Sidecar 전체화면:
 *   ⛶ 버튼 → position:fixed, inset:0 → 2열 대시보드
 *   왼쪽: Source + 고니오미터 + 레벨미터 + Correlation + LUFS 수치
 *   오른쪽: RTA (메인 뷰) 또는 선택 뷰 + 타깃 판정
 *
 * 반응형 브레이크포인트:
 *   < 520px  : 모바일 (1열)
 *   520–1023 : 태블릿 (1열 + 컴팩트)
 *   ≥ 1024   : 데스크톱/iPad (2열 대시보드)
 *
 * 비용: $0 (Web Audio API, Canvas 2D, 무료 오픈소스만)
 */

import { useState, useRef, useEffect } from 'react'
import { useAudioCapture }  from '../../hooks/useAudioCapture'
import { useLoudnessMeter, type LoudnessMetrics } from '../../hooks/useLoudnessMeter'
import Goniometer           from './Goniometer'
import LevelMeter           from './LevelMeter'
import CorrelationMeter     from './CorrelationMeter'
import LoudnessHistory      from './LoudnessHistory'
import AudioSourceSelector  from './AudioSourceSelector'
import RTA, { type RTAProps } from './RTA'

// ── 플랫폼 프리셋 ─────────────────────────────────────────────────────────────

const PLATFORM_PRESETS = [
  { id: 'youtube',  label: 'YouTube',     target: -14 },
  { id: 'spotify',  label: 'Spotify',     target: -14 },
  { id: 'apple',    label: 'Apple Music', target: -16 },
  { id: 'netflix',  label: 'Netflix',     target: -27 },
  { id: 'ebu_r128', label: 'EBU R128',    target: -23 },
] as const

type PlatformId = (typeof PLATFORM_PRESETS)[number]['id']
type ViewId     = 'goniometer' | 'rta' | 'scope'
type Averaging  = RTAProps['averaging']
type DbRange    = RTAProps['dbRange']

// ── 반응형 훅 ─────────────────────────────────────────────────────────────────

function useContainerWidth(ref: { current: HTMLDivElement | null }): number {
  const [w, setW] = useState(700)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect) setW(rect.width)
    })
    ro.observe(el)
    setW(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [ref])
  return w
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────

function lufsStr(v: number): string {
  return isFinite(v) ? v.toFixed(1) : '-∞'
}

type JudgmentStatus = 'ok' | 'warn' | 'fail' | 'none'

function lufsStatus(v: number, target: number): JudgmentStatus {
  if (!isFinite(v)) return 'none'
  const d = v - target
  if (d >= -3 && d <= 1) return 'ok'
  if (d >  1 && d <= 3)  return 'warn'
  if (d > 3)             return 'fail'
  return 'warn'
}

const S_COLOR: Record<JudgmentStatus, string> = {
  ok:   '#00c853',
  warn: '#ffd600',
  fail: '#ff1744',
  none: 'rgba(255,255,255,0.55)',
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────────────────

export default function ClarityM() {
  const [platformId, setPlatformId] = useState<PlatformId>('youtube')
  const [view,       setView]       = useState<ViewId>('goniometer')
  const [fullscreen, setFullscreen] = useState(false)
  const [averaging,  setAveraging]  = useState<Averaging>('medium')
  const [dbRange,    setDbRange]    = useState<DbRange>(80)
  const containerRef = useRef<HTMLDivElement>(null)

  const capture  = useAudioCapture()
  const loudness = useLoudnessMeter(capture.state.stream)

  const containerW = useContainerWidth(containerRef)
  const effectiveW = fullscreen ? window.innerWidth : containerW
  const isMobile   = effectiveW < 520
  const isTablet   = effectiveW >= 520 && effectiveW < 1024
  const isDesktop  = effectiveW >= 1024

  const platform = PLATFORM_PRESETS.find(p => p.id === platformId) ?? PLATFORM_PRESETS[0]!
  const target   = platform.target
  const { metrics } = loudness

  const PADDING = isMobile ? 12 : isDesktop ? 18 : 14

  useEffect(() => {
    document.body.style.overflow = fullscreen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [fullscreen])

  const innerW    = effectiveW - PADDING * 2
  const gonioSize = isDesktop ? 240 : isTablet ? 220 : Math.min(innerW, 280)
  const rtaH      = isDesktop ? (fullscreen ? window.innerHeight - 220 : 320)
                   : isTablet ? 260
                   : 220
  const rtaW      = isDesktop
    ? (fullscreen ? Math.floor(innerW * 0.62) : innerW)
    : innerW
  const histW = Math.min(innerW, isDesktop ? 540 : innerW)
  const histH = isMobile ? 110 : 150

  const wrapStyle: React.CSSProperties = fullscreen ? {
    position:   'fixed',
    inset:      0,
    zIndex:     9999,
    overflowY:  'auto',
    borderRadius: 0,
    background: '#080810',
    border:     'none',
  } : {
    background:    '#0d0d14',
    border:        '1px solid #2a2a30',
    borderRadius:  isMobile ? 8 : 12,
    overflow:      'hidden',
    width:         '100%',
    boxSizing:     'border-box' as const,
  }

  return (
    <div ref={containerRef} style={wrapStyle}>

      {/* ── 헤더 ──────────────────────────────────────────────────────── */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        isMobile ? '10px 12px' : '12px 18px',
        borderBottom:   '1px solid #2a2a30',
        background:     '#10101a',
        flexWrap:       'wrap',
        gap:            8,
        position:       'sticky',
        top:            0,
        zIndex:         10,
      }}>
        {/* 타이틀 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize:   isMobile ? 12 : 14,
              fontWeight: 700,
              letterSpacing: 2.5,
              color: '#00c853',
            }}>
              CLARITY M
            </span>
            {!isMobile && (
              <span style={{
                fontFamily:   'JetBrains Mono, monospace',
                fontSize:     9,
                color:        'rgba(255,255,255,0.4)',
                letterSpacing: 1,
              }}>
                ITU-R BS.1770-4 · EBU R128
              </span>
            )}
          </div>

          {/* 활성 인디케이터 */}
          {capture.state.isCapturing && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(0,200,83,0.1)',
              border: '1px solid rgba(0,200,83,0.4)',
              borderRadius: 20,
              padding: '3px 9px',
            }}>
              <span style={{
                width: 6, height: 6, borderRadius: '50%',
                background: '#00c853', display: 'inline-block',
              }} />
              <span style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 10, color: '#00c853',
              }}>
                LIVE
              </span>
            </div>
          )}
        </div>

        {/* 뷰 탭 + RTA 설정 + 전체화면 */}
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>

          {/* 뷰 탭 */}
          {(['goniometer', 'rta', 'scope'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding:      isMobile ? '5px 10px' : '6px 14px',
              border:       `1px solid ${view === v ? '#00c853' : '#2a2a30'}`,
              borderRadius: 5,
              background:   view === v ? 'rgba(0,200,83,0.12)' : 'transparent',
              color:        view === v ? '#00c853' : 'rgba(255,255,255,0.5)',
              fontFamily:   'JetBrains Mono, monospace',
              fontSize:     isMobile ? 10 : 11,
              fontWeight:   700,
              cursor:       'pointer',
              letterSpacing: 1,
              minHeight:    isMobile ? 32 : 30,
            }}>
              {v === 'goniometer' ? 'GONIO' : v === 'rta' ? 'RTA' : 'SCOPE'}
            </button>
          ))}

          {/* RTA 설정 (RTA 탭일 때만) */}
          {view === 'rta' && !isMobile && (
            <>
              <select
                value={averaging}
                onChange={e => setAveraging(e.target.value as Averaging)}
                style={selectStyle}
                title="응답 속도"
              >
                <option value="fast">FAST</option>
                <option value="medium">MED</option>
                <option value="slow">SLOW</option>
              </select>
              <select
                value={dbRange}
                onChange={e => setDbRange(Number(e.target.value) as DbRange)}
                style={selectStyle}
                title="dB 레인지"
              >
                <option value={60}>60dB</option>
                <option value={80}>80dB</option>
              </select>
            </>
          )}

          {/* iPad 전체화면 토글 */}
          <button
            onClick={() => setFullscreen(f => !f)}
            title={fullscreen ? '전체화면 종료' : 'iPad 전체화면'}
            style={{
              padding:      isMobile ? '5px 8px' : '6px 10px',
              border:       `1px solid ${fullscreen ? '#ffd600' : '#2a2a30'}`,
              borderRadius: 5,
              background:   fullscreen ? 'rgba(255,214,0,0.12)' : 'transparent',
              color:        fullscreen ? '#ffd600' : 'rgba(255,255,255,0.5)',
              fontFamily:   'JetBrains Mono, monospace',
              fontSize:     isMobile ? 11 : 13,
              cursor:       'pointer',
              minHeight:    isMobile ? 32 : 30,
              minWidth:     isMobile ? 32 : 34,
            }}
          >
            {fullscreen ? '✕' : '⛶'}
          </button>
        </div>
      </div>

      {/* ── 콘텐츠 ────────────────────────────────────────────────────── */}
      {isDesktop && fullscreen
        ? <DesktopDashboard
            capture={capture}
            loudness={loudness}
            metrics={metrics}
            target={target}
            platform={platform}
            view={view}
            gonioSize={gonioSize}
            rtaW={rtaW}
            rtaH={rtaH}
            histW={histW}
            histH={histH}
            averaging={averaging}
            dbRange={dbRange}
            padding={PADDING}
            setPlatformId={setPlatformId}
          />
        : <div style={{ padding: PADDING, display: 'flex', flexDirection: 'column', gap: isMobile ? 10 : 14 }}>

            {/* 소스 선택기 */}
            <AudioSourceSelector
              state={capture.state}
              onStartMicrophone={capture.startMicrophone}
              onStartBlackHole={capture.startBlackHole}
              onStartDisplay={capture.startDisplay}
              onStop={capture.stop}
              onRefresh={capture.refreshDevices}
              isMobile={isMobile}
            />

            {/* 플랫폼 프리셋 */}
            <PlatformSelector
              platformId={platformId}
              setPlatformId={setPlatformId}
              isMobile={isMobile}
            />

            {/* LUFS 수치 그리드 */}
            <MetricsGrid
              metrics={metrics}
              target={target}
              isMobile={isMobile}
            />

            {/* 메인 뷰 */}
            {view === 'goniometer' && (
              <GoniometerView
                stream={capture.state.stream}
                metrics={metrics}
                gonioSize={gonioSize}
                isMobile={isMobile}
              />
            )}
            {view === 'rta' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {isMobile && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <select value={averaging} onChange={e => setAveraging(e.target.value as Averaging)} style={selectStyleMobile}>
                      <option value="fast">FAST</option>
                      <option value="medium">MED</option>
                      <option value="slow">SLOW</option>
                    </select>
                    <select value={dbRange} onChange={e => setDbRange(Number(e.target.value) as DbRange)} style={selectStyleMobile}>
                      <option value={60}>60dB</option>
                      <option value={80}>80dB</option>
                    </select>
                  </div>
                )}
                <RTA
                  stream={capture.state.stream}
                  width={innerW}
                  height={rtaH}
                  averaging={averaging}
                  dbRange={dbRange}
                />
                <RTALegend />
              </div>
            )}
            {view === 'scope' && (
              <div style={{ overflowX: 'auto' }}>
                <LoudnessHistory
                  metrics={metrics}
                  target={target}
                  durationSeconds={60}
                  width={histW}
                  height={histH}
                />
              </div>
            )}

            {/* 타깃 판정 */}
            <TargetJudgement
              metrics={metrics}
              target={target}
              platformLabel={platform.label}
              isMobile={isMobile}
            />

            {/* 리셋 */}
            <button onClick={loudness.reset} style={{
              padding:      '10px 18px',
              background:   'transparent',
              border:       '1px solid #2a2a30',
              borderRadius: 6,
              color:        'rgba(255,255,255,0.45)',
              fontSize:     11,
              fontFamily:   'JetBrains Mono, monospace',
              cursor:       'pointer',
              letterSpacing: 1,
              alignSelf:    'flex-start',
              minHeight:    38,
            }}>
              I / LRA 리셋
            </button>
          </div>
      }
    </div>
  )
}

// ── iPad 전체화면 2열 대시보드 ─────────────────────────────────────────────────

function DesktopDashboard({
  capture, loudness, metrics, target, platform,
  view, gonioSize, rtaW, rtaH, histW, histH,
  averaging, dbRange, padding, setPlatformId,
}: {
  capture:         ReturnType<typeof useAudioCapture>
  loudness:        ReturnType<typeof useLoudnessMeter>
  metrics:         LoudnessMetrics
  target:          number
  platform:        { id: string; label: string; target: number }
  view:            ViewId
  gonioSize:       number
  rtaW:            number
  rtaH:            number
  histW:           number
  histH:           number
  averaging:       Averaging
  dbRange:         DbRange
  padding:         number
  setPlatformId:   (id: PlatformId) => void
}) {
  return (
    <div style={{
      display:   'grid',
      gridTemplateColumns: '290px 1fr',
      gap:       0,
      height:    `calc(100vh - 48px)`,
      overflow:  'hidden',
    }}>
      {/* 왼쪽 패널 */}
      <div style={{
        borderRight: '1px solid #2a2a30',
        overflowY:   'auto',
        padding:     padding,
        display:     'flex',
        flexDirection: 'column',
        gap:         12,
        background:  '#0a0a12',
      }}>
        <AudioSourceSelector
          state={capture.state}
          onStartMicrophone={capture.startMicrophone}
          onStartBlackHole={capture.startBlackHole}
          onStartDisplay={capture.startDisplay}
          onStop={capture.stop}
          onRefresh={capture.refreshDevices}
          isMobile={false}
        />

        {/* 고니오미터 */}
        <div style={{
          display: 'flex', justifyContent: 'center',
          background: '#0d0d10', borderRadius: 8,
          padding: 10, border: '1px solid #2a2a30',
        }}>
          <Goniometer stream={capture.state.stream} width={gonioSize} height={gonioSize} />
        </div>

        {/* 레벨 미터 + 상관계수 */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', justifyContent: 'center' }}>
          <LevelMeter tpL={metrics.instL} tpR={metrics.instR} peakHold />
          <div>
            <div style={{
              fontSize: 9, letterSpacing: 1.5,
              color: 'rgba(255,255,255,0.45)',
              fontFamily: 'JetBrains Mono, monospace',
              marginBottom: 6,
            }}>
              CORRELATION
            </div>
            <CorrelationMeter stream={capture.state.stream} />
          </div>
        </div>

        {/* LUFS 수치 (2열 컴팩트) */}
        <MetricsGrid metrics={metrics} target={target} isMobile={false} compact />

        {/* 리셋 */}
        <button onClick={loudness.reset} style={{
          padding:    '8px 14px',
          background: 'transparent',
          border:     '1px solid #2a2a30',
          borderRadius: 5,
          color:      'rgba(255,255,255,0.45)',
          fontSize:   10,
          fontFamily: 'JetBrains Mono, monospace',
          cursor:     'pointer',
          alignSelf:  'flex-start',
          letterSpacing: 0.5,
        }}>
          I / LRA 리셋
        </button>
      </div>

      {/* 오른쪽 패널 */}
      <div style={{
        overflowY:     'auto',
        padding:       padding,
        display:       'flex',
        flexDirection: 'column',
        gap:           12,
      }}>
        {/* 플랫폼 프리셋 */}
        <PlatformSelector platformId={platform.id as PlatformId} setPlatformId={setPlatformId} isMobile={false} />

        {/* 뷰 */}
        {view === 'rta' && (
          <>
            <RTA
              stream={capture.state.stream}
              width={rtaW}
              height={rtaH}
              averaging={averaging}
              dbRange={dbRange}
            />
            <RTALegend />
          </>
        )}
        {view === 'goniometer' && (
          <GoniometerView
            stream={capture.state.stream}
            metrics={metrics}
            gonioSize={Math.min(rtaW, 380)}
            isMobile={false}
          />
        )}
        {view === 'scope' && (
          <LoudnessHistory
            metrics={metrics}
            target={target}
            durationSeconds={60}
            width={Math.min(rtaW, histW)}
            height={histH}
          />
        )}

        {/* 타깃 판정 */}
        <TargetJudgement
          metrics={metrics}
          target={target}
          platformLabel={platform.label}
          isMobile={false}
        />
      </div>
    </div>
  )
}

// ── 서브 컴포넌트들 ────────────────────────────────────────────────────────────

function GoniometerView({
  stream, metrics, gonioSize, isMobile,
}: {
  stream:    MediaStream | null
  metrics:   LoudnessMetrics
  gonioSize: number
  isMobile:  boolean
}) {
  return (
    <div style={{
      display:       'flex',
      flexDirection: isMobile ? 'column' : 'row',
      gap:           isMobile ? 12 : 18,
      alignItems:    isMobile ? 'center' : 'flex-start',
    }}>
      <Goniometer stream={stream} width={gonioSize} height={gonioSize} />
      <div style={{
        display:       'flex',
        flexDirection: isMobile ? 'row' : 'column',
        gap:           14,
        alignItems:    'flex-start',
        justifyContent: isMobile ? 'center' : 'flex-start',
        width:         isMobile ? '100%' : 'auto',
      }}>
        <LevelMeter tpL={metrics.instL} tpR={metrics.instR} peakHold />
        <div>
          <div style={{
            fontSize: 10, letterSpacing: 1.5,
            color: 'rgba(255,255,255,0.45)',
            fontFamily: 'JetBrains Mono, monospace',
            marginBottom: 6,
          }}>
            CORRELATION
          </div>
          <CorrelationMeter stream={stream} />
        </div>
      </div>
    </div>
  )
}

function PlatformSelector({
  platformId, setPlatformId, isMobile,
}: {
  platformId:     string
  setPlatformId:  (id: PlatformId) => void
  isMobile:       boolean
}) {
  return (
    <div>
      <div style={{
        fontSize: 10, letterSpacing: 1.5,
        color: 'rgba(255,255,255,0.4)',
        fontFamily: 'JetBrains Mono, monospace',
        marginBottom: 7,
      }}>
        플랫폼 타깃
      </div>
      <div style={{ display: 'flex', gap: isMobile ? 5 : 6, flexWrap: 'wrap' }}>
        {PLATFORM_PRESETS.map(p => (
          <button key={p.id} onClick={() => setPlatformId(p.id)} style={{
            padding:      isMobile ? '5px 9px' : '6px 12px',
            border:       `1px solid ${platformId === p.id ? '#00c853' : '#2a2a30'}`,
            borderRadius: 5,
            background:   platformId === p.id ? 'rgba(0,200,83,.15)' : 'transparent',
            color:        platformId === p.id ? '#00c853' : 'rgba(255,255,255,0.5)',
            fontFamily:   'JetBrains Mono, monospace',
            fontSize:     isMobile ? 10 : 11,
            fontWeight:   700,
            cursor:       'pointer',
            whiteSpace:   'nowrap',
            minHeight:    isMobile ? 32 : 30,
          }}>
            {isMobile ? `${p.target}` : `${p.label} ${p.target}`}
          </button>
        ))}
      </div>
    </div>
  )
}

function MetricsGrid({
  metrics, target, isMobile, compact = false,
}: {
  metrics:  LoudnessMetrics
  target:   number
  isMobile: boolean
  compact?: boolean
}) {
  const cols = compact ? 2 : isMobile ? 2 : 3
  return (
    <div style={{
      display:             'grid',
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap:                 isMobile ? 8 : 10,
    }}>
      <MetricCell label="MOMENTARY"  value={lufsStr(metrics.M)}    unit="LUFS"  status={lufsStatus(metrics.M, target)} isMobile={isMobile} compact={compact} />
      <MetricCell label="SHORT-TERM" value={lufsStr(metrics.S)}    unit="LUFS"  status={lufsStatus(metrics.S, target)} isMobile={isMobile} compact={compact} />
      <MetricCell label="INTEGRATED" value={lufsStr(metrics.I)}    unit="LUFS"  status={lufsStatus(metrics.I, target)} isMobile={isMobile} compact={compact} />
      <MetricCell label="LRA"        value={isFinite(metrics.LRA) ? metrics.LRA.toFixed(1) : '—'} unit="LU" status="none" isMobile={isMobile} compact={compact} />
      <MetricCell label="TP L"       value={isFinite(metrics.TP_L) ? metrics.TP_L.toFixed(1) : '-∞'} unit="dBTP" status={metrics.TP_L > -1 ? 'fail' : 'ok'} isMobile={isMobile} compact={compact} />
      <MetricCell label="TP R"       value={isFinite(metrics.TP_R) ? metrics.TP_R.toFixed(1) : '-∞'} unit="dBTP" status={metrics.TP_R > -1 ? 'fail' : 'ok'} isMobile={isMobile} compact={compact} />
    </div>
  )
}

function MetricCell({
  label, value, unit, status, isMobile, compact = false,
}: {
  label:    string
  value:    string
  unit:     string
  status:   JudgmentStatus
  isMobile: boolean
  compact?: boolean
}) {
  const color = S_COLOR[status]
  return (
    <div style={{
      background:   '#141420',
      border:       `1px solid ${color}55`,
      borderRadius: isMobile ? 6 : 8,
      padding:      compact ? '10px 12px' : isMobile ? '10px 12px' : '13px 15px',
    }}>
      <div style={{
        fontSize:      compact ? 9 : isMobile ? 9 : 10,
        letterSpacing: 1,
        color:         'rgba(255,255,255,0.5)',
        fontFamily:    'JetBrains Mono, monospace',
        marginBottom:  4,
        whiteSpace:    'nowrap',
        overflow:      'hidden',
        textOverflow:  'ellipsis',
      }}>
        {label}
      </div>
      <div style={{
        fontFamily:    'JetBrains Mono, monospace',
        fontSize:      compact ? 20 : isMobile ? 22 : 28,
        fontWeight:    700,
        color,
        lineHeight:    1.1,
        letterSpacing: -0.5,
      }}>
        {value}
      </div>
      <div style={{
        fontSize:   compact ? 9 : isMobile ? 9 : 10,
        color:      'rgba(255,255,255,0.45)',
        fontFamily: 'JetBrains Mono, monospace',
        marginTop:  3,
      }}>
        {unit}
      </div>
    </div>
  )
}

function TargetJudgement({
  metrics, target, platformLabel, isMobile,
}: {
  metrics:       LoudnessMetrics
  target:        number
  platformLabel: string
  isMobile:      boolean
}) {
  const status = lufsStatus(metrics.I, target)
  const color  = S_COLOR[status]
  const labels: Record<JudgmentStatus, string> = { ok: 'PASS', warn: 'NEAR', fail: 'FAIL', none: '—' }
  const diff   = isFinite(metrics.I) ? metrics.I - target : null

  const descs: Record<JudgmentStatus, string> = {
    ok:   `${platformLabel} ${target} LUFS 타깃 범위 내`,
    warn: `타깃 대비 ${diff !== null ? diff.toFixed(1) : '?'}LU 벗어남`,
    fail: `타깃 초과 — ${diff !== null ? diff.toFixed(1) : '?'}LU 낮추세요`,
    none: '측정 대기 중 — 오디오를 시작하세요',
  }

  return (
    <div style={{
      background:     `${color}10`,
      border:         `1px solid ${color}`,
      borderRadius:   isMobile ? 7 : 9,
      padding:        isMobile ? '11px 14px' : '13px 16px',
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'space-between',
      gap:            10,
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <div style={{
          fontSize: 9, letterSpacing: 1.5,
          color: 'rgba(255,255,255,0.4)',
          fontFamily: 'JetBrains Mono, monospace',
          whiteSpace: 'nowrap',
        }}>
          {platformLabel.toUpperCase()} 판정
        </div>
        <div style={{
          fontSize: isMobile ? 12 : 13,
          color: 'rgba(255,255,255,0.7)',
          fontFamily: 'monospace', lineHeight: 1.4,
        }}>
          {descs[status]}
        </div>
      </div>
      <div style={{
        fontFamily:    'JetBrains Mono, monospace',
        fontSize:      isMobile ? 22 : 26,
        fontWeight:    700,
        color,
        letterSpacing: 2,
        flexShrink:    0,
      }}>
        {labels[status]}
      </div>
    </div>
  )
}

/** RTA 주파수 범위 범례 */
function RTALegend() {
  const items = [
    { label: 'SUB',    color: '#9b59ff', range: '20–50Hz' },
    { label: 'BASS',   color: '#ff6b35', range: '63–160Hz' },
    { label: 'L.MID',  color: '#ffd600', range: '200–630Hz' },
    { label: 'MID',    color: '#00e676', range: '800Hz–3kHz' },
    { label: 'H.MID',  color: '#40c4ff', range: '4–6kHz' },
    { label: 'HIGH',   color: '#64d8ff', range: '8–20kHz' },
  ]
  return (
    <div style={{
      display: 'flex', flexWrap: 'wrap', gap: '5px 14px',
      padding: '5px 2px',
    }}>
      {items.map(({ label, color, range }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            display: 'inline-block', width: 9, height: 9,
            background: color, borderRadius: 2, flexShrink: 0,
          }} />
          <span style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize:   9,
            color:      'rgba(255,255,255,0.55)',
          }}>
            {label} <span style={{ color: 'rgba(255,255,255,0.35)' }}>{range}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

// ── 공통 스타일 ───────────────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  background:   '#0d0d14',
  border:       '1px solid #2a2a30',
  borderRadius: 4,
  color:        'rgba(255,255,255,0.6)',
  fontFamily:   'JetBrains Mono, monospace',
  fontSize:     10,
  padding:      '4px 6px',
  cursor:       'pointer',
  height:       28,
  outline:      'none',
}

const selectStyleMobile: React.CSSProperties = {
  ...selectStyle,
  height:    36,
  fontSize:  11,
  flex:      1,
}

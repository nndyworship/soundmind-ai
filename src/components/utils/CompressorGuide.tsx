import { useState, useRef, useEffect, useCallback } from 'react'
import presetData from '../../data/compressorPresets.json'
import FaderSlider from '../ui/FaderSlider'
import KnobControl from '../ui/KnobControl'
import { parseGuardedText } from '../../lib/hallucinationGuard'

// ── 타입 ─────────────────────────────────────────────────────────────────

interface Preset {
  label: string
  ratio: number
  attackMs: number
  releaseMs: number
  thresholdDBFS: number
  kneeDB: number
  makeupDB: number
  GR_dB: [number, number]
  topology: string
  blend?: number
  transientNote: string
  ruleOfThumb: string
}

interface Instrument {
  id: string
  name: string
  emoji: string
  color: string
  character: string
  transientProfile: {
    attackPhaseMs: [number, number]
    bodyPhaseMs:   [number, number]
    tailPhaseMs:   [number, number]
    peakCrestFactor_dB: number
    description: string
  }
  presets: Record<string, Preset>
  faderDefault: number
  freqZones: Array<{ label: string; hz: number; role: string }>
}

const instruments = presetData.instruments as unknown as Instrument[]
const goldenRules  = presetData.goldenRules
const topologies   = presetData.compTopologies as Record<string, { character: string; hardwareRef: string }>

// ── 트랜지언트 커브 시각화 ─────────────────────────────────────────────

function drawTransientCurve(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  instr: Instrument,
  preset: Preset
) {
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)

  const PAD_L = 36, PAD_B = 24, PAD_T = 16
  const plotW = W - PAD_L - 8
  const plotH = H - PAD_T - PAD_B

  // 그리드
  ctx.strokeStyle = '#151515'; ctx.lineWidth = 1
  ;[-6, -12, -18, -24, -30].forEach(db => {
    const y = PAD_T + plotH * (-db / 36)
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - 8, y); ctx.stroke()
    ctx.fillStyle = '#2a2a2a'; ctx.font = '9px monospace'
    ctx.fillText(`${db}`, 0, y + 3)
  })

  const totalMs = 600
  const msToX   = (ms: number) => PAD_L + (ms / totalMs) * plotW
  const dbToY    = (db: number) => PAD_T + plotH * (1 - (db + 36) / 36)

  // ── 원본 트랜지언트 (Dry) ─────────────────────────────────────────
  const [atk0, atk1] = instr.transientProfile.attackPhaseMs
  const [bdy0, bdy1] = instr.transientProfile.bodyPhaseMs
  const peakDB = -instr.transientProfile.peakCrestFactor_dB + 36 - 36  // 0 ~ -peakCrest
  const peakDBVal = -(instr.transientProfile.peakCrestFactor_dB - 36) - 36

  ctx.strokeStyle = '#333'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3])
  ctx.beginPath()
  ctx.moveTo(msToX(0), dbToY(-36))
  ctx.lineTo(msToX(atk0), dbToY(-36))
  ctx.lineTo(msToX(atk1), dbToY(-6))           // 피크
  ctx.lineTo(msToX(bdy0 + 20), dbToY(-14))     // 바디
  ctx.lineTo(msToX(bdy1), dbToY(-22))           // 디케이
  ctx.lineTo(msToX(totalMs), dbToY(-36))
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#333'; ctx.font = '9px monospace'
  ctx.fillText('원본', msToX(atk1) + 4, dbToY(-5))

  // ── 컴프레스된 커브 ──────────────────────────────────────────────
  const thDB    = preset.thresholdDBFS          // -20 같은 음수
  const ratio   = preset.ratio
  const atkMs   = preset.attackMs
  const relMs   = preset.releaseMs

  // 컴프 작동 후 신호 레벨 계산 (단순화)
  function compressDB(inputDB: number, timeMs: number): number {
    const overThresh = inputDB - thDB
    if (overThresh <= 0 || timeMs < atkMs) return inputDB
    const grFull  = overThresh - overThresh / ratio
    const grBlend = Math.min(1, (timeMs - atkMs) / (atkMs + 5))
    return inputDB - grFull * grBlend
  }

  const color = instr.color
  ctx.strokeStyle = color; ctx.lineWidth = 2.5
  ctx.shadowColor = color + '66'; ctx.shadowBlur = 4
  ctx.beginPath()

  const STEPS = 120
  for (let s = 0; s <= STEPS; s++) {
    const ms = (s / STEPS) * totalMs
    let rawDB: number
    if (ms < atk0) rawDB = -36
    else if (ms < atk1) rawDB = -36 + ((-6) - (-36)) * ((ms - atk0) / (atk1 - atk0))
    else if (ms < bdy1) rawDB = -6 + ((-22) - (-6)) * ((ms - atk1) / (bdy1 - atk1))
    else rawDB = -22 + ((-36) - (-22)) * ((ms - bdy1) / (totalMs - bdy1))

    const compressed = compressDB(rawDB, ms)
    const x = msToX(ms)
    const y = dbToY(Math.max(-36, compressed))
    if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = color; ctx.font = 'bold 9px monospace'
  ctx.fillText('컴프 후', msToX(atkMs + 40) + 4, dbToY(-9))

  // ── 어택 타임 마커 ───────────────────────────────────────────────
  ctx.strokeStyle = '#ffb300'; ctx.lineWidth = 1; ctx.setLineDash([3, 3])
  const atkX = msToX(atkMs)
  ctx.beginPath(); ctx.moveTo(atkX, PAD_T); ctx.lineTo(atkX, H - PAD_B); ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#ffb300'; ctx.font = 'bold 9px monospace'
  ctx.fillText(`ATK ${atkMs}ms`, atkX + 2, PAD_T + 10)

  // ── 릴리즈 타임 마커 ──────────────────────────────────────────────
  ctx.strokeStyle = '#0a84ff'; ctx.lineWidth = 1; ctx.setLineDash([3, 3])
  const relX = msToX(Math.min(atkMs + relMs, totalMs - 20))
  ctx.beginPath(); ctx.moveTo(relX, PAD_T); ctx.lineTo(relX, H - PAD_B); ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#0a84ff'; ctx.font = 'bold 9px monospace'
  ctx.fillText(`REL ${relMs}ms`, relX + 2, PAD_T + 10)

  // ── 스레숄드 라인 ─────────────────────────────────────────────────
  ctx.strokeStyle = '#ff3b3066'; ctx.lineWidth = 1
  const thrYReal = PAD_T + plotH * (-thDB / 36)
  ctx.beginPath(); ctx.moveTo(PAD_L, thrYReal); ctx.lineTo(W - 8, thrYReal); ctx.stroke()
  ctx.fillStyle = '#ff3b30'; ctx.font = '9px monospace'
  ctx.fillText(`THR ${thDB}dBFS`, PAD_L + 4, thrYReal - 3)

  // ── x축 레이블 ────────────────────────────────────────────────────
  ctx.fillStyle = '#2a2a2a'; ctx.font = '9px monospace'
  ;[0, 100, 200, 300, 400, 500, 600].forEach(ms => {
    ctx.fillText(`${ms}`, msToX(ms) - 6, H - 6)
  })
  ctx.fillStyle = '#2a2a2a'
  ctx.fillText('ms', W - 20, H - 6)

  void peakDB; void peakDBVal
}

// ── 컴프레서 전달 함수 (Transfer Curve) ──────────────────────────────────

function drawTransferCurve(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  preset: Preset,
  color: string
) {
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H)

  const PAD = 24
  const plotW = W - PAD - 4
  const plotH = H - PAD - 4
  const DB_RANGE = 40

  // 1:1 기준선
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1
  ctx.beginPath(); ctx.moveTo(PAD, H - PAD); ctx.lineTo(W - 4, 4); ctx.stroke()

  // 축
  ctx.fillStyle = '#222'; ctx.font = '8px monospace'
  ctx.fillText('IN', W - 14, H - 4)
  ctx.fillText('OUT', PAD, 10)

  // 스레숄드 + 니 라인
  const thr    = preset.thresholdDBFS   // 음수 dBFS
  const knee   = preset.kneeDB
  const ratio  = preset.ratio

  function outDB(inDB: number): number {
    const over = inDB - thr
    if (over <= -knee / 2) return inDB
    if (over <= knee / 2 && knee > 0) {
      return inDB + ((1 / ratio - 1) * Math.pow(over + knee / 2, 2)) / (2 * knee)
    }
    return thr + (inDB - thr) / ratio
  }

  const xToInDB = (x: number) => -DB_RANGE + ((x - PAD) / plotW) * DB_RANGE

  // 전달 함수 커브
  ctx.strokeStyle = color; ctx.lineWidth = 2
  ctx.shadowColor = color + '44'; ctx.shadowBlur = 3
  ctx.beginPath()
  for (let px = 0; px <= plotW; px++) {
    const inDB  = xToInDB(PAD + px)
    const outed = outDB(inDB)
    const y     = H - PAD - ((outed + DB_RANGE) / DB_RANGE) * plotH
    if (px === 0) ctx.moveTo(PAD + px, y); else ctx.lineTo(PAD + px, y)
  }
  ctx.stroke()
  ctx.shadowBlur = 0

  // 스레숄드 마커
  const thrX = PAD + ((thr + DB_RANGE) / DB_RANGE) * plotW
  ctx.strokeStyle = '#ff3b3044'; ctx.lineWidth = 1; ctx.setLineDash([3, 3])
  ctx.beginPath(); ctx.moveTo(thrX, 4); ctx.lineTo(thrX, H - PAD); ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = '#ff3b30'; ctx.font = '8px monospace'
  ctx.fillText(`${thr}`, thrX - 8, H - PAD + 12)

  // GR 표시
  ctx.fillStyle = '#555'; ctx.font = '8px monospace'
  ctx.fillText(`${ratio}:1`, PAD + 4, 20)

}

// ── 실시간 노브 조언 엔진 ──────────────────────────────────────────────────

interface ParamAdvice {
  param:       string
  value:       string
  status:      'good' | 'warn' | 'danger'
  description: string
  problem:     string
  tip:         string
}

function getLiveAdvice(p: Preset, instr: Instrument): ParamAdvice[] {
  const advice: ParamAdvice[] = []
  const atkWindow = instr.transientProfile.attackPhaseMs[1]  // 트랜지언트 지속 시간

  // ── ATTACK ────────────────────────────────────────────────────────────
  if (p.attackMs <= atkWindow * 0.5) {
    advice.push({
      param: 'ATTACK', value: `${p.attackMs}ms`,
      status: 'danger',
      description: `어택(${p.attackMs}ms)이 ${instr.name} 트랜지언트(${atkWindow}ms)보다 훨씬 짧습니다.`,
      problem: `초기 어택이 컴프에 잡혀 '클릭감·픽 어택·자음 질감'이 소멸합니다. 소리가 납작하고 생기 없이 들립니다.`,
      tip: `최소 ${atkWindow}ms 이상으로 올리세요. ${instr.name}의 트랜지언트를 통과시킨 후 압축이 시작되어야 합니다.`,
    })
  } else if (p.attackMs <= atkWindow) {
    advice.push({
      param: 'ATTACK', value: `${p.attackMs}ms`,
      status: 'warn',
      description: `어택(${p.attackMs}ms)이 ${instr.name} 트랜지언트 구간(${atkWindow}ms) 내에 있습니다.`,
      problem: `트랜지언트 일부가 압축됩니다. 어택감이 약해질 수 있습니다.`,
      tip: `의도적인 어택 억제라면 OK. 아니라면 ${atkWindow + 5}ms 이상으로 올리세요.`,
    })
  } else {
    advice.push({
      param: 'ATTACK', value: `${p.attackMs}ms`,
      status: 'good',
      description: `어택(${p.attackMs}ms)이 ${instr.name} 트랜지언트(${atkWindow}ms)를 완전히 통과시킵니다.`,
      problem: '',
      tip: `현재 어택은 자연스러운 트랜지언트 보존에 최적입니다. 더 올리면 피크 제어력이 낮아집니다.`,
    })
  }

  // ── RELEASE ───────────────────────────────────────────────────────────
  if (p.releaseMs < 30) {
    advice.push({
      param: 'RELEASE', value: `${p.releaseMs}ms`,
      status: 'danger',
      description: `릴리즈(${p.releaseMs}ms)가 매우 짧습니다.`,
      problem: `GR이 너무 빨리 복귀해 '펌핑(Pumping)' 또는 '브리딩(Breathing)' 아티팩트가 발생합니다. 특히 ${instr.name} 같은 서스테인이 있는 악기에서 두드러집니다.`,
      tip: `최소 60ms 이상으로 올리세요. 빠른 패시지라도 40ms 이하는 피하는 것이 좋습니다.`,
    })
  } else if (p.releaseMs > 400 && instr.character === 'percussive') {
    advice.push({
      param: 'RELEASE', value: `${p.releaseMs}ms`,
      status: 'warn',
      description: `릴리즈(${p.releaseMs}ms)가 타악기 계열에 비해 깁니다.`,
      problem: `이전 히트의 GR이 다음 히트까지 남아있어 다음 트랜지언트가 약해집니다. 드럼 그루브가 뭉개질 수 있습니다.`,
      tip: `BPM에 맞춰 줄이세요. 120BPM 기준 최대 250ms 권장입니다.`,
    })
  } else {
    advice.push({
      param: 'RELEASE', value: `${p.releaseMs}ms`,
      status: 'good',
      description: `릴리즈(${p.releaseMs}ms)가 ${instr.name}에 적합한 범위입니다.`,
      problem: '',
      tip: `음악의 BPM을 기준으로 릴리즈를 미세 조정하세요. 한 박자의 절반 이하가 일반적인 기준입니다.`,
    })
  }

  // ── RATIO ─────────────────────────────────────────────────────────────
  const ratioVal = p.ratio
  if (ratioVal >= 10 && !['edrum','drum_oh','kick','snare'].includes(instr.id)) {
    advice.push({
      param: 'RATIO', value: `${ratioVal.toFixed(1)}:1`,
      status: 'danger',
      description: `비율(${ratioVal.toFixed(1)}:1)이 ${instr.name}에 매우 높습니다.`,
      problem: `음악적 다이나믹이 거의 사라집니다. 감정 표현이 소멸하고 소리가 '눌린' 느낌이 납니다.`,
      tip: `단독 사용 시 4:1 이하를 권장합니다. 10:1 이상은 패러렐 컴프(Dry 블렌드)로만 사용하세요.`,
    })
  } else if (ratioVal < 1.5) {
    advice.push({
      param: 'RATIO', value: `${ratioVal.toFixed(1)}:1`,
      status: 'warn',
      description: `비율(${ratioVal.toFixed(1)}:1)이 매우 낮아 컴프 효과가 거의 없습니다.`,
      problem: `피크 제어가 거의 안 됩니다. 스레숄드를 낮춰도 의미 있는 GR이 나오지 않습니다.`,
      tip: `효과적인 컴프를 원하면 최소 2:1 이상으로 올리세요.`,
    })
  } else {
    advice.push({
      param: 'RATIO', value: `${ratioVal.toFixed(1)}:1`,
      status: 'good',
      description: `비율(${ratioVal.toFixed(1)}:1)이 ${instr.name}에 적절한 범위입니다.`,
      problem: '',
      tip: `${ratioVal < 4 ? '글루 컴프 범위입니다. GR을 3~6dB로 유지하면 자연스럽습니다.' : '다이나믹 컨트롤 범위입니다. GR이 과도하지 않은지 확인하세요.'}`,
    })
  }

  // ── THRESHOLD ─────────────────────────────────────────────────────────
  const thrVal = p.thresholdDBFS
  if (thrVal > -8) {
    advice.push({
      param: 'THRESHOLD', value: `${thrVal}dBFS`,
      status: 'warn',
      description: `스레숄드(${thrVal}dBFS)가 높아 피크에서만 컴프가 작동합니다.`,
      problem: `평균 레벨에서는 컴프가 거의 작동하지 않습니다. 피크 리미팅에 가까운 동작을 합니다.`,
      tip: `컴프를 '음악적으로' 사용하려면 -15~-25dBFS 범위가 일반적입니다.`,
    })
  } else if (thrVal < -30) {
    advice.push({
      param: 'THRESHOLD', value: `${thrVal}dBFS`,
      status: 'warn',
      description: `스레숄드(${thrVal}dBFS)가 낮아 거의 모든 신호가 압축됩니다.`,
      problem: `프로그램 전체가 항상 압축된 상태입니다. 다이나믹이 사라지고 피로감을 줄 수 있습니다.`,
      tip: `메이크업 게인을 낮추고 스레숄드를 올리거나, 패러렐 컴프 방식을 고려하세요.`,
    })
  } else {
    advice.push({
      param: 'THRESHOLD', value: `${thrVal}dBFS`,
      status: 'good',
      description: `스레숄드(${thrVal}dBFS)가 적절한 범위입니다.`,
      problem: '',
      tip: `피크 신호가 스레숄드를 얼마나 초과하는지 GR 미터로 확인하며 조정하세요.`,
    })
  }

  // ── 조합 경고 ─────────────────────────────────────────────────────────
  if (p.attackMs < 5 && p.releaseMs < 50 && ratioVal > 6) {
    advice.push({
      param: 'COMBO', value: '조합 경고',
      status: 'danger',
      description: '빠른 어택 + 짧은 릴리즈 + 높은 비율의 조합입니다.',
      problem: '소리가 극도로 압축되어 왜곡(Distortion)이 발생할 수 있습니다. 특히 저음역 악기에서 두드러집니다.',
      tip: '세 파라미터 중 하나를 완화하세요. 패러렐 컴프 방식으로 전환하는 것도 좋은 해결책입니다.',
    })
  }

  return advice
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────

export default function CompressorGuide() {
  const [activeId,     setActiveId]    = useState('vocal')
  const [presetKey,    setPresetKey]   = useState('natural')
  const [faderDb,      setFaderDb]     = useState(0)
  const [liveRatio,    setLiveRatio]   = useState(0.3)
  const [liveAttack,   setLiveAttack]  = useState(0.3)
  const [liveRelease,  setLiveRelease] = useState(0.4)
  const [liveThresh,   setLiveThresh]  = useState(0.5)
  const [showRules,    setShowRules]   = useState(false)
  const [lastChanged,  setLastChanged] = useState<string | null>(null)

  const transCanvasRef  = useRef<HTMLCanvasElement>(null)
  const transferCanvasRef = useRef<HTMLCanvasElement>(null)

  const activeInstr = instruments.find(i => i.id === activeId)!
  const presetKeys  = Object.keys(activeInstr.presets)
  const preset      = activeInstr.presets[presetKey] ?? activeInstr.presets[presetKeys[0]!]!

  // 악기 변경 시 첫 번째 프리셋으로 리셋
  const selectInstr = useCallback((id: string) => {
    const instr = instruments.find(i => i.id === id)!
    const firstKey = Object.keys(instr.presets)[0]!
    const firstPreset = instr.presets[firstKey]!
    setActiveId(id)
    setPresetKey(firstKey)
    setFaderDb(instr.faderDefault)
    setLiveRatio(  (firstPreset.ratio - 1) / 19)
    setLiveAttack( firstPreset.attackMs / 200)
    setLiveRelease(firstPreset.releaseMs / 600)
    setLiveThresh( (-firstPreset.thresholdDBFS) / 40)
  }, [])

  // 프리셋 선택 시 노브 동기화
  const selectPreset = useCallback((key: string) => {
    const p = activeInstr.presets[key]!
    setPresetKey(key)
    setLiveRatio(  (p.ratio - 1) / 19)
    setLiveAttack( p.attackMs / 200)
    setLiveRelease(p.releaseMs / 600)
    setLiveThresh( (-p.thresholdDBFS) / 40)
  }, [activeInstr])

  // 노브값 → 실제 파라미터
  const livePreset: Preset = {
    ...preset,
    ratio:          1 + liveRatio * 19,
    attackMs:       Math.round(liveAttack * 200),
    releaseMs:      Math.round(liveRelease * 600),
    thresholdDBFS:  Math.round(-liveThresh * 40),
  }

  // 트랜지언트 커브 렌더링
  useEffect(() => {
    const c = transCanvasRef.current; if (!c) return
    const ctx = c.getContext('2d'); if (!ctx) return
    drawTransientCurve(ctx, c.width, c.height, activeInstr, livePreset)
  }, [activeInstr, livePreset])

  // 전달 함수 렌더링
  useEffect(() => {
    const c = transferCanvasRef.current; if (!c) return
    const ctx = c.getContext('2d'); if (!ctx) return
    drawTransferCurve(ctx, c.width, c.height, livePreset, activeInstr.color)
  }, [livePreset, activeInstr.color])

  const color = activeInstr.color

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)',
                  borderRadius: 12, overflow: 'hidden' }}>

      {/* 헤더 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700,
                       letterSpacing: 2, color: '#bf5af2' }}>
          COMPRESSOR GUIDE
        </span>
        <button onClick={() => setShowRules(p => !p)} style={{
          padding: '6px 14px', border: '1px solid #1f1f1f', borderRadius: 6, cursor: 'pointer',
          background: showRules ? '#1a0a2a' : 'transparent', color: showRules ? '#bf5af2' : '#555',
          fontSize: 11, fontFamily: 'monospace', letterSpacing: 1,
        }}>
          7 GOLDEN RULES
        </button>
      </div>

      {/* 골든 룰 */}
      {showRules && (
        <div style={{ background: '#0a0010', borderBottom: '1px solid var(--border)',
                      padding: '14px 20px' }}>
          {goldenRules.map((rule, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                             color: '#bf5af2', minWidth: 20 }}>{i + 1}.</span>
              <span style={{ fontSize: 12, color: '#888', fontFamily: 'monospace',
                             lineHeight: 1.6 }}>{rule}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* 악기 선택 */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {instruments.map(instr => (
            <button key={instr.id} onClick={() => selectInstr(instr.id)} style={{
              padding: '8px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
              fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
              border: `2px solid ${activeId === instr.id ? instr.color : '#1f1f1f'}`,
              background: activeId === instr.id ? instr.color + '22' : 'transparent',
              color: activeId === instr.id ? instr.color : '#555',
            }}>
              {instr.emoji} {instr.name}
            </button>
          ))}
        </div>

        {/* 트랜지언트 프로파일 */}
        <div style={{ background: 'var(--bg-elevated)', border: `1px solid ${color}33`,
                      borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, letterSpacing: 1, color: '#555', fontFamily: 'monospace',
                        marginBottom: 8 }}>
            TRANSIENT PROFILE — {activeInstr.name}
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
            {[
              { l: '어택 구간', v: `${activeInstr.transientProfile.attackPhaseMs[0]}~${activeInstr.transientProfile.attackPhaseMs[1]}ms` },
              { l: '바디 구간', v: `${activeInstr.transientProfile.bodyPhaseMs[0]}~${activeInstr.transientProfile.bodyPhaseMs[1]}ms` },
              { l: '크레스트 팩터', v: `${activeInstr.transientProfile.peakCrestFactor_dB} dB` },
            ].map(p => (
              <div key={p.l}>
                <div style={{ fontSize: 9, color: '#444', fontFamily: 'monospace', letterSpacing: 1 }}>{p.l}</div>
                <div style={{ fontSize: 15, fontFamily: 'JetBrains Mono, monospace',
                              fontWeight: 700, color }}>{p.v}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#666', fontFamily: 'monospace', lineHeight: 1.7 }}>
            {activeInstr.transientProfile.description}
          </div>
        </div>

        {/* 프리셋 선택 */}
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1, color: '#555', fontFamily: 'monospace',
                        marginBottom: 10 }}>프리셋 선택</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {presetKeys.map(key => {
              const p = activeInstr.presets[key]!
              return (
                <button key={key} onClick={() => selectPreset(key)} style={{
                  padding: '8px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 11,
                  fontFamily: 'monospace', fontWeight: 700,
                  border: `1px solid ${presetKey === key ? color : '#1f1f1f'}`,
                  background: presetKey === key ? color + '18' : 'transparent',
                  color: presetKey === key ? color : '#555',
                }}>
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* 인터랙티브 노브 + 페이더 섹션 */}
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 8,
                      border: '1px solid var(--border)', padding: '20px 16px' }}>
          <div style={{ fontSize: 10, letterSpacing: 1, color: '#555', fontFamily: 'monospace',
                        marginBottom: 20 }}>
            COMPRESSOR CONTROLS — 드래그로 조절 / 더블클릭 리셋
          </div>

          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {/* 페이더 (채널 레벨) */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 9, color: '#444', fontFamily: 'monospace', letterSpacing: 1 }}>
                채널 레벨
              </div>
              <FaderSlider
                value={faderDb}
                onChange={setFaderDb}
                color={color}
                label={activeInstr.name}
                height={240}
              />
            </div>

            {/* 컴프 노브 4개 */}
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', flex: 1 }}>
              <KnobControl
                value={liveRatio}
                onChange={v => { setLiveRatio(v); setLastChanged('RATIO') }}
                label="RATIO"
                displayValue={`${(1 + liveRatio * 19).toFixed(1)}:1`}
                color={color}
              />
              <KnobControl
                value={liveAttack}
                onChange={v => { setLiveAttack(v); setLastChanged('ATTACK') }}
                label="ATTACK"
                displayValue={`${Math.round(liveAttack * 200)}ms`}
                color={color}
              />
              <KnobControl
                value={liveRelease}
                onChange={v => { setLiveRelease(v); setLastChanged('RELEASE') }}
                label="RELEASE"
                displayValue={`${Math.round(liveRelease * 600)}ms`}
                color={color}
              />
              <KnobControl
                value={liveThresh}
                onChange={v => { setLiveThresh(v); setLastChanged('THRESHOLD') }}
                label="THRESHOLD"
                displayValue={`${Math.round(-liveThresh * 40)}dBFS`}
                color={color}
              />

              {/* GR 미터 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 9, color: '#444', fontFamily: 'monospace',
                              letterSpacing: 1, textAlign: 'center' }}>GR 범위</div>
                <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a',
                              borderRadius: 6, padding: '8px 12px', textAlign: 'center' }}>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 16,
                                fontWeight: 700, color: preset.GR_dB[1] >= 8 ? '#ff3b30' : '#ffb300' }}>
                    {preset.GR_dB[0]}~{preset.GR_dB[1]} dB
                  </div>
                  <div style={{ fontSize: 9, color: '#444', fontFamily: 'monospace', marginTop: 2 }}>
                    GAIN REDUCTION
                  </div>
                </div>
                <div style={{ background: '#0a0a0a', border: '1px solid #1a1a1a',
                              borderRadius: 6, padding: '6px 10px', textAlign: 'center', marginTop: 4 }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#666' }}>
                    {topologies[preset.topology]?.character ?? preset.topology}
                  </div>
                  <div style={{ fontSize: 9, color: '#2a2a2a', fontFamily: 'monospace', marginTop: 2 }}>
                    {topologies[preset.topology]?.hardwareRef ?? ''}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 듀얼 캔버스: 트랜지언트 커브 + 전달 함수 */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1, color: '#555',
                          fontFamily: 'monospace', marginBottom: 6 }}>
              트랜지언트 커브 — 회색: 원본 / 컬러: 컴프 후
            </div>
            <canvas ref={transCanvasRef} width={560} height={180}
              style={{ width: '100%', height: 180, display: 'block',
                       borderRadius: 6, border: '1px solid var(--border)' }} />
          </div>
          <div>
            <div style={{ fontSize: 10, letterSpacing: 1, color: '#555',
                          fontFamily: 'monospace', marginBottom: 6 }}>
              전달 함수 (Input→Output)
            </div>
            <canvas ref={transferCanvasRef} width={200} height={180}
              style={{ width: '100%', height: 180, display: 'block',
                       borderRadius: 6, border: '1px solid var(--border)' }} />
          </div>
        </div>

        {/* 실시간 노브 조언 패널 */}
        <LiveAdvicePanel
          advice={getLiveAdvice(livePreset, activeInstr)}
          lastChanged={lastChanged}
          color={color}
        />

        {/* 트랜지언트 노트 + 룰 오브 썸 */}
        <div style={{ background: '#050508', border: `1px solid ${color}22`,
                      borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ fontSize: 10, letterSpacing: 1, color: '#444',
                        fontFamily: 'monospace', marginBottom: 10 }}>
            트랜지언트 지각 분석 — {preset.label}
          </div>
          <div style={{ fontSize: 12, color: '#888', fontFamily: 'monospace',
                        lineHeight: 1.8, marginBottom: 12 }}>
            <span style={{ color, fontWeight: 700 }}>어택 {livePreset.attackMs}ms: </span>
            {preset.transientNote}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ color: '#ffb300', fontSize: 11, fontFamily: 'monospace',
                           whiteSpace: 'nowrap' }}>RULE:</span>
            <span style={{ fontSize: 11, color: '#555', fontFamily: 'monospace',
                           lineHeight: 1.6 }}>{preset.ruleOfThumb}</span>
          </div>
          {preset.blend !== undefined && (
            <div style={{ marginTop: 10, padding: '8px 12px', background: '#0a0a14',
                          borderRadius: 6, fontSize: 11, color: '#0a84ff', fontFamily: 'monospace' }}>
              패러렐 블렌드: Dry {100 - preset.blend}% / Wet {preset.blend}%
            </div>
          )}
        </div>

        {/* 주파수 존 참조 */}
        <div>
          <div style={{ fontSize: 10, letterSpacing: 1, color: '#555',
                        fontFamily: 'monospace', marginBottom: 10 }}>
            EQ 연동 — 컴프 이후 주파수 존 참조
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {activeInstr.freqZones.map(z => (
              <div key={z.label} style={{
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '8px 12px', flex: 1, minWidth: 120,
              }}>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13,
                              fontWeight: 700, color }}>
                  {z.hz >= 1000 ? `${z.hz / 1000}kHz` : `${z.hz}Hz`}
                </div>
                <div style={{ fontSize: 9, color: '#444', fontFamily: 'monospace',
                              letterSpacing: 1, marginTop: 2 }}>{z.label}</div>
                <div style={{ fontSize: 11, color: '#666', fontFamily: 'monospace',
                              marginTop: 4 }}>{z.role}</div>
              </div>
            ))}
          </div>
        </div>

        {/* AI 질문 패널 */}
        <CompAskPanel
          instrument={activeInstr.name}
          preset={presetKey}
          ratio={livePreset.ratio}
          attackMs={livePreset.attackMs}
          releaseMs={livePreset.releaseMs}
          thresholdDBFS={livePreset.thresholdDBFS}
          color={color}
        />

      </div>
    </div>
  )
}

// ── 실시간 조언 패널 ──────────────────────────────────────────────────────

const STATUS_COLOR: Record<ParamAdvice['status'], string> = {
  good:   'var(--accent-green)',
  warn:   'var(--accent-amber)',
  danger: 'var(--accent-red)',
}
const STATUS_ICON: Record<ParamAdvice['status'], string> = {
  good: '✓', warn: '⚠', danger: '✕',
}

function LiveAdvicePanel({
  advice,
  lastChanged,
  color,
}: {
  advice:      ParamAdvice[]
  lastChanged: string | null
  color:       string
}) {
  const sorted = lastChanged
    ? [...advice].sort((a, b) =>
        a.param === lastChanged ? -1 : b.param === lastChanged ? 1 : 0
      )
    : advice

  return (
    <div style={{
      background:   'var(--bg-elevated)',
      border:       `1px solid ${color}22`,
      borderRadius: 8,
      overflow:     'hidden',
    }}>
      <div style={{
        padding:       '10px 16px',
        borderBottom:  `1px solid ${color}22`,
        display:       'flex',
        alignItems:    'center',
        gap:           8,
      }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
        <span style={{
          fontFamily:    "'JetBrains Mono', monospace",
          fontSize:      11,
          fontWeight:    700,
          color,
          letterSpacing: 1,
        }}>
          LIVE ADVISOR
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: "'Inter', sans-serif" }}>
          노브를 움직이면 실시간으로 조언합니다
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {sorted.map((a, i) => {
          const isHighlighted = a.param === lastChanged
          const statusColor   = STATUS_COLOR[a.status]
          return (
            <div key={i} style={{
              padding:    '12px 16px',
              background: isHighlighted ? `${statusColor}08` : 'transparent',
              borderLeft: isHighlighted ? `3px solid ${statusColor}` : '3px solid transparent',
              transition: 'all 0.2s',
            }}>
              {/* 파라미터 헤더 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  fontFamily:    "'JetBrains Mono', monospace",
                  fontSize:      10,
                  fontWeight:    700,
                  color:         statusColor,
                  letterSpacing: 1,
                  minWidth:      90,
                }}>
                  {STATUS_ICON[a.status]} {a.param}
                </span>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize:   12,
                  fontWeight: 700,
                  color:      statusColor,
                }}>
                  {a.value}
                </span>
              </div>

              {/* 현재 상태 설명 */}
              <div style={{
                fontSize:   12,
                color:      'var(--text-primary)',
                lineHeight: 1.6,
                fontFamily: "'Inter', system-ui, sans-serif",
                marginBottom: a.problem ? 6 : 0,
              }}>
                {a.description}
              </div>

              {/* 문제점 (있을 때만) */}
              {a.problem && (
                <div style={{
                  fontSize:     11,
                  color:        statusColor,
                  lineHeight:   1.6,
                  fontFamily:   "'Inter', system-ui, sans-serif",
                  background:   `${statusColor}0a`,
                  borderRadius: 4,
                  padding:      '6px 10px',
                  marginBottom: 6,
                }}>
                  <span style={{ fontWeight: 700 }}>문제: </span>{a.problem}
                </div>
              )}

              {/* 실무 조언 */}
              <div style={{
                fontSize:   11,
                color:      'var(--text-secondary)',
                lineHeight: 1.6,
                fontFamily: "'Inter', system-ui, sans-serif",
                paddingLeft: 4,
                borderLeft:  '2px solid var(--border)',
              }}>
                <span style={{ color: 'var(--accent-amber)', fontWeight: 700 }}>조언: </span>
                {a.tip}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── CompAskPanel — 컴프레서 인라인 AI 질문 패널 ──────────────────────────────

interface CompAskPanelProps {
  instrument:    string   // 악기 이름 (예: 보컬)
  preset:        string   // 프리셋 키 (예: natural)
  ratio:         number
  attackMs:      number
  releaseMs:     number
  thresholdDBFS: number
  color:         string   // 악기 색상 (CSS hex)
}

interface RagResponse {
  expertAnswer: string
  trackA:       { answer: string }
  trackB:       { answer: string }
}

function CompAskPanel({
  instrument, preset, ratio, attackMs, releaseMs, thresholdDBFS, color,
}: CompAskPanelProps) {
  const [query,   setQuery]   = useState('')
  const [answer,  setAnswer]  = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const buildContext = (): string =>
    `[Compressor Context: 악기=${instrument}, Preset=${preset}, ` +
    `Ratio=${ratio.toFixed(1)}:1, Attack=${attackMs}ms, ` +
    `Release=${releaseMs}ms, Threshold=${thresholdDBFS}dBFS]`

  const send = async () => {
    const q = query.trim()
    if (!q || loading) return
    setLoading(true)
    setError(null)
    setAnswer(null)

    try {
      const fullQuery = `${buildContext()}\n사용자 질문: ${q}`
      const res  = await fetch('/api/rag', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query: fullQuery }),
      })
      if (!res.ok) throw new Error(`서버 오류 ${res.status}`)
      const data = await res.json() as RagResponse
      // hallucinationGuard 통과 필수 (SPEC.md 요건)
      const lines = parseGuardedText(data.expertAnswer ?? '')
      setAnswer(lines.map(l => l.text).join('\n'))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 응답 실패')
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div style={{
      background:   'var(--bg-elevated)',
      border:       `1px solid ${color}33`,
      borderRadius: 8,
      overflow:     'hidden',
    }}>
      {/* 헤더 */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 16px',
        borderBottom: `1px solid ${color}22`,
      }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
        <span style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
          fontWeight: 700, color, letterSpacing: 1,
        }}>
          AI ADVISOR
        </span>
        <span style={{
          fontSize: 10, color: 'var(--text-muted)',
          fontFamily: 'Inter, sans-serif',
        }}>
          현재 설정 기준으로 질문하세요
        </span>
      </div>

      {/* 컨텍스트 미리보기 */}
      <div style={{
        padding: '8px 16px',
        fontSize: 9, color: 'var(--text-muted)',
        fontFamily: 'JetBrains Mono, monospace',
        borderBottom: `1px solid ${color}11`,
        lineHeight: 1.6,
      }}>
        {buildContext()}
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* 입력 */}
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="예: 이 세팅에서 보컬이 펌핑되는 이유는? (Enter로 전송)"
            rows={2}
            style={{
              flex:         1,
              background:   '#000',
              border:       `1px solid ${color}44`,
              borderRadius: 6,
              color:        'var(--text-primary)',
              fontSize:     12,
              fontFamily:   'Inter, sans-serif',
              padding:      '8px 12px',
              resize:       'none',
              lineHeight:   1.6,
              outline:      'none',
            }}
          />
          <button
            onClick={() => { void send() }}
            disabled={loading || !query.trim()}
            style={{
              minWidth:     56,
              minHeight:    56,
              background:   loading ? 'transparent' : `${color}22`,
              border:       `1px solid ${color}`,
              borderRadius: 6,
              color,
              fontSize:     16,
              cursor:       loading || !query.trim() ? 'default' : 'pointer',
              opacity:      loading || !query.trim() ? 0.4 : 1,
              flexShrink:   0,
            }}
          >
            {loading ? '…' : '▶'}
          </button>
        </div>

        {/* 에러 */}
        {error && (
          <div style={{
            background:   'var(--accent-red-10)',
            border:       '1px solid var(--accent-red)',
            borderRadius: 6,
            padding:      '8px 12px',
            fontSize:     12, color: 'var(--accent-red)',
            fontFamily:   'monospace',
          }}>
            {error}
          </div>
        )}

        {/* AI 응답 */}
        {answer && (
          <div style={{
            background:   '#000',
            border:       `1px solid ${color}22`,
            borderRadius: 6,
            padding:      '12px 14px',
            fontSize:     12, color: 'var(--text-primary)',
            fontFamily:   'Inter, system-ui, sans-serif',
            lineHeight:   1.8,
            whiteSpace:   'pre-wrap',
          }}>
            {answer}
          </div>
        )}

      </div>
    </div>
  )
}

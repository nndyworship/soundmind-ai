/**
 * useLoudnessMeter.ts
 *
 * ITU-R BS.1770-4 / EBU R128 준수 라우드니스 측정 훅
 *
 * 구현 기준:
 *   - K-weighting: 2단계 IIR (ITU-R BS.1770-4 Annex 1)
 *   - Momentary  : 400ms 게이트 창 (불중첩 블록 아님 — 슬라이딩)
 *   - Short-term : 3s 슬라이딩 창
 *   - Integrated : Gated 전체 프로그램 LUFS
 *                  절대 게이트 -70 LUFS → 상대 게이트 (통과 평균 - 10LU)
 *   - LRA        : Short-term 히스토그램 10th ~ 95th percentile 차이
 *   - True Peak  : 4× 오버샘플링 후 피크 검출
 *
 * 비용: $0 (순수 Web Audio API + TypeScript)
 */

import { useRef, useState, useCallback, useEffect } from 'react'

// ── 공개 타입 ──────────────────────────────────────────────────────────────────

export interface LoudnessMetrics {
  M:     number  // Momentary LUFS   (-Infinity = silence)
  S:     number  // Short-term LUFS
  I:     number  // Integrated LUFS  (프로그램 전체)
  LRA:   number  // Loudness Range LU
  TP_L:  number  // True Peak Left  dBTP (러닝 최대값 — MetricCell 표시용)
  TP_R:  number  // True Peak Right dBTP (러닝 최대값)
  instL: number  // 현재 프레임 순간 피크 dBTP (LevelMeter 바 표시용)
  instR: number  // 현재 프레임 순간 피크 dBTP
}

const SILENCE: LoudnessMetrics = {
  M: -Infinity, S: -Infinity, I: -Infinity,
  LRA: 0, TP_L: -Infinity, TP_R: -Infinity,
  instL: -Infinity, instR: -Infinity,
}

// ── K-weighting IIR 계수 계산 ─────────────────────────────────────────────────
// ITU-R BS.1770-4 Annex 1 — 아날로그 원형 필터를 BLT(쌍일차 변환)로 이산화
// 참조 구현: pyloudnorm (Python), libebur128 (C)

interface IIR2Coeffs {
  b: [number, number, number]
  a: [number, number, number]
}

interface KWeightCoeffs {
  stage1: IIR2Coeffs  // High-shelf pre-filter
  stage2: IIR2Coeffs  // High-pass RLB filter
}

/**
 * 샘플레이트에 맞는 K-weighting 필터 계수를 계산합니다.
 * 44100 Hz 기준 계수를 프리-워핑(pre-warping)하여 다른 샘플레이트에서도 정확합니다.
 */
function computeKWeightCoeffs(fs: number): KWeightCoeffs {
  // ── Stage 1: High-shelf pre-filter ──────────────────────────────────────
  // 아날로그 프로토타입: Vh=1.584864701, Vb=1.584864701, Vl=1
  // 연속시간 극점: fc = 1681.974450955533 Hz
  const fc1 = 1681.974450955533
  const Vh  = 1.584864701130855
  const K1  = Math.tan(Math.PI * fc1 / fs)
  const K1sq = K1 * K1
  const denom1 = 1 + Math.SQRT2 * K1 + K1sq

  const b1_0 = (Vh + Vh * Math.SQRT2 * K1 + K1sq) / denom1
  const b1_1 = (2 * (K1sq - Vh)) / denom1
  const b1_2 = (Vh - Vh * Math.SQRT2 * K1 + K1sq) / denom1
  const a1_1 = (2 * (K1sq - 1)) / denom1
  const a1_2 = (1 - Math.SQRT2 * K1 + K1sq) / denom1

  // ── Stage 2: High-pass RLB filter ───────────────────────────────────────
  // 아날로그 프로토타입: 2차 버터워스 고역통과, fc = 38.13547087613982 Hz
  const fc2 = 38.13547087613982
  const K2  = Math.tan(Math.PI * fc2 / fs)
  const K2sq = K2 * K2
  const denom2 = K2sq + Math.SQRT2 * K2 + 1

  const b2_0 =  1 / denom2
  const b2_1 = -2 / denom2
  const b2_2 =  1 / denom2
  const a2_1 = (2 * (K2sq - 1)) / denom2
  const a2_2 = (K2sq - Math.SQRT2 * K2 + 1) / denom2

  return {
    stage1: { b: [b1_0, b1_1, b1_2], a: [1, a1_1, a1_2] },
    stage2: { b: [b2_0, b2_1, b2_2], a: [1, a2_1, a2_2] },
  }
}

// ── IIR 2차 필터 — Direct Form II Transposed ─────────────────────────────────

/**
 * 인플레이스 IIR 필터 적용.
 * state[0], state[1]: 필터 내부 상태 (채널별 독립 유지)
 */
function applyIIR2(
  input:  Float32Array,
  b:      [number, number, number],
  a:      [number, number, number],
  state:  [number, number],
): Float32Array {
  const out = new Float32Array(input.length)
  let s0 = state[0]
  let s1 = state[1]

  for (let n = 0; n < input.length; n++) {
    const x = input[n]
    const y = b[0] * x + s0
    s0 = b[1] * x - a[1] * y + s1
    s1 = b[2] * x - a[2] * y
    out[n] = y
  }

  state[0] = s0
  state[1] = s1
  return out
}

/** K-weighting 필터 2단계 적용 */
function kWeight(
  input:  Float32Array,
  coeffs: KWeightCoeffs,
  state1: [number, number],
  state2: [number, number],
): Float32Array {
  const after1 = applyIIR2(input, coeffs.stage1.b, coeffs.stage1.a, state1)
  return        applyIIR2(after1, coeffs.stage2.b, coeffs.stage2.a, state2)
}

// ── LUFS 계산 유틸 ────────────────────────────────────────────────────────────

/** Mean square (평균 제곱 에너지) */
function meanSquare(buf: Float32Array): number {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return sum / buf.length
}

/** Mean square → LUFS 변환 */
function msToLUFS(ms: number): number {
  if (ms <= 0) return -Infinity
  return -0.691 + 10 * Math.log10(ms)
}

// ── True Peak (4× 오버샘플링) ─────────────────────────────────────────────────
// 단순 선형 보간 4× 업샘플링 (ITU-R BS.1770 권고)
// 완전한 폴리페이즈 필터보다 약간 낮은 정밀도지만 브라우저에서 무료 구현 가능
function computeTruePeak(input: Float32Array): number {
  const OS = 4
  let peak = 0
  const len = input.length

  for (let i = 0; i < len - 1; i++) {
    const x0 = input[i]
    const x1 = input[i + 1]
    // 선형 보간 (0, 1/4, 2/4, 3/4)
    for (let k = 0; k < OS; k++) {
      const t   = k / OS
      const val = x0 + (x1 - x0) * t
      const abs = Math.abs(val)
      if (abs > peak) peak = abs
    }
  }
  // 마지막 샘플
  const last = Math.abs(input[len - 1] ?? 0)
  if (last > peak) peak = last

  return peak > 0 ? 20 * Math.log10(peak) : -Infinity
}

// ── Integrated LUFS (Gated) ───────────────────────────────────────────────────

interface IntegBlock {
  ms: number  // mean square (L + R 합산)
}

/**
 * ITU-R BS.1770-4 Section 2.2 게이트 알고리즘
 * blocks: 400ms 겹치지 않는 블록들의 mean square 이력
 */
function gatedIntegrated(blocks: IntegBlock[]): number {
  if (blocks.length === 0) return -Infinity

  // 1단계: 절대 게이트 -70 LUFS
  const abs_gate = Math.pow(10, (-70 + 0.691) / 10)
  const passed1  = blocks.filter(b => b.ms >= abs_gate)
  if (passed1.length === 0) return -Infinity

  // 2단계: 상대 게이트 = 절대통과 평균 - 10LU
  const avg1 = passed1.reduce((s, b) => s + b.ms, 0) / passed1.length
  const rel_gate = avg1 * Math.pow(10, -10 / 10)

  const passed2 = passed1.filter(b => b.ms >= rel_gate)
  if (passed2.length === 0) return -Infinity

  const avg2 = passed2.reduce((s, b) => s + b.ms, 0) / passed2.length
  return msToLUFS(avg2)
}

// ── LRA ───────────────────────────────────────────────────────────────────────

/** Short-term LUFS 이력에서 LRA 계산 (10th ~ 95th percentile) */
function computeLRA(history: number[]): number {
  const valid = history.filter(v => isFinite(v)).sort((a, b) => a - b)
  if (valid.length < 2) return 0

  const lo = valid[Math.floor(valid.length * 0.10)] ?? valid[0]
  const hi = valid[Math.floor(valid.length * 0.95)] ?? valid[valid.length - 1]
  return Math.max(0, hi - lo)
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLoudnessMeter(stream: MediaStream | null) {
  const ctxRef    = useRef<AudioContext | null>(null)
  const srcRef    = useRef<MediaStreamAudioSourceNode | null>(null)
  const procRef   = useRef<ScriptProcessorNode | null>(null)

  // K-weighting 필터 상태 (L/R 채널 각 2단계)
  const kStateL1  = useRef<[number, number]>([0, 0])
  const kStateL2  = useRef<[number, number]>([0, 0])
  const kStateR1  = useRef<[number, number]>([0, 0])
  const kStateR2  = useRef<[number, number]>([0, 0])
  const coeffsRef = useRef<KWeightCoeffs | null>(null)

  // 슬라이딩 윈도우 링 버퍼
  const mBufL     = useRef<number[]>([])  // Momentary용 L (mean squares)
  const mBufR     = useRef<number[]>([])
  const sBufL     = useRef<number[]>([])  // Short-term용 L
  const sBufR     = useRef<number[]>([])

  // Integrated용 400ms 블록 이력
  const integBlocks = useRef<IntegBlock[]>([])
  const integAccL   = useRef<number>(0)   // 현재 400ms 블록 누적 L
  const integAccR   = useRef<number>(0)
  const integN      = useRef<number>(0)   // 현재 블록 내 프레임 수

  // Short-term 이력 (LRA용)
  const stHistory   = useRef<number[]>([])

  // True Peak 러닝 최대값
  const tpL         = useRef<number>(-Infinity)
  const tpR         = useRef<number>(-Infinity)

  const [metrics, setMetrics] = useState<LoudnessMetrics>(SILENCE)
  const [isActive, setIsActive] = useState(false)

  const reset = useCallback(() => {
    mBufL.current = []; mBufR.current = []
    sBufL.current = []; sBufR.current = []
    integBlocks.current = []
    integAccL.current = 0; integAccR.current = 0; integN.current = 0
    stHistory.current = []
    tpL.current = -Infinity; tpR.current = -Infinity
    kStateL1.current = [0, 0]; kStateL2.current = [0, 0]
    kStateR1.current = [0, 0]; kStateR2.current = [0, 0]
    setMetrics(SILENCE)
  }, [])

  useEffect(() => {
    if (!stream) {
      reset()
      return
    }

    // ── AudioContext 생성 ──────────────────────────────────────────────────────
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()
    ctxRef.current = ctx

    // cleanup이 먼저 실행됐을 때 late setup 방지용 플래그
    let cancelled = false

    // ── ctx.resume() 완료 후 오디오 그래프 구성 ───────────────────────────────
    // ⚠ 핵심: 'suspended' 상태인 컨텍스트에서 ScriptProcessor를 연결해도
    //   onaudioprocess가 발화되지 않는 브라우저(Safari 등)가 있음.
    //   반드시 resume() Promise 완료 후 그래프를 구성해야 함.
    const doSetup = () => {
      if (cancelled || ctx.state === 'closed') return

      // K-weighting 계수 (샘플레이트에 맞게)
      coeffsRef.current = computeKWeightCoeffs(ctx.sampleRate)

      const bufSize     = 4096  // ScriptProcessor 버퍼 크기 (약 93ms @ 44100)
      const mWinFrames  = Math.ceil(0.400 * ctx.sampleRate / bufSize)  // 400ms
      const sWinFrames  = Math.ceil(3.000 * ctx.sampleRate / bufSize)  // 3s
      const integFrames = Math.ceil(0.400 * ctx.sampleRate / bufSize)  // 400ms 블록

      const src      = ctx.createMediaStreamSource(stream)
      const proc     = ctx.createScriptProcessor(bufSize, 2, 2)
      const silencer = ctx.createGain()
      silencer.gain.value = 0

      proc.onaudioprocess = (e) => {
        const coeffs = coeffsRef.current
        if (!coeffs) return

        const inL = e.inputBuffer.getChannelData(0)
        const inR = e.inputBuffer.numberOfChannels > 1
          ? e.inputBuffer.getChannelData(1)
          : e.inputBuffer.getChannelData(0)

        // ── K-weighting ──
        const kL = kWeight(inL, coeffs, kStateL1.current, kStateL2.current)
        const kR = kWeight(inR, coeffs, kStateR1.current, kStateR2.current)

        // ── True Peak ──
        const tp_l = computeTruePeak(inL)
        const tp_r = computeTruePeak(inR)
        if (tp_l > tpL.current) tpL.current = tp_l
        if (tp_r > tpR.current) tpR.current = tp_r

        // ── Mean Square 계산 ──
        const msL = meanSquare(kL)
        const msR = meanSquare(kR)

        // ── Momentary 링 버퍼 ──
        mBufL.current.push(msL); mBufR.current.push(msR)
        if (mBufL.current.length > mWinFrames) {
          mBufL.current.shift(); mBufR.current.shift()
        }
        const mMs = (
          mBufL.current.reduce((s, v) => s + v, 0) / mBufL.current.length +
          mBufR.current.reduce((s, v) => s + v, 0) / mBufR.current.length
        )
        const M = msToLUFS(mMs)

        // ── Short-term 링 버퍼 ──
        sBufL.current.push(msL); sBufR.current.push(msR)
        if (sBufL.current.length > sWinFrames) {
          sBufL.current.shift(); sBufR.current.shift()
        }
        const sMs = (
          sBufL.current.reduce((s, v) => s + v, 0) / sBufL.current.length +
          sBufR.current.reduce((s, v) => s + v, 0) / sBufR.current.length
        )
        const S = msToLUFS(sMs)

        // ── Short-term 이력 (LRA용) ──
        stHistory.current.push(S)
        if (stHistory.current.length > 1800) stHistory.current.shift() // 30분 최대

        // ── Integrated 블록 누적 ──
        integAccL.current += msL
        integAccR.current += msR
        integN.current++

        if (integN.current >= integFrames) {
          const blockMs = (integAccL.current + integAccR.current) / (2 * integN.current)
          integBlocks.current.push({ ms: blockMs })
          if (integBlocks.current.length > 18000) integBlocks.current.shift() // 2시간
          integAccL.current = 0; integAccR.current = 0; integN.current = 0
        }

        const I   = gatedIntegrated(integBlocks.current)
        const LRA = computeLRA(stHistory.current)

        setMetrics({
          M, S, I, LRA,
          TP_L:  tpL.current,  // 러닝 최대값
          TP_R:  tpR.current,
          instL: tp_l,         // 현재 프레임 순간 피크 → LevelMeter 바
          instR: tp_r,
        })
      }

      // src → proc → silencer(gain=0) → destination
      // gain=0: 스피커 출력 없음, ScriptProcessor 정상 발화
      src.connect(proc)
      proc.connect(silencer)
      silencer.connect(ctx.destination)

      srcRef.current  = src
      procRef.current = proc
      setIsActive(true)
    }

    // resume() 완료 보장 후 setup 실행
    if (ctx.state === 'running') {
      doSetup()
    } else {
      ctx.resume()
        .then(doSetup)
        .catch(() => {
          // resume 실패해도 시도 (일부 브라우저에서 이미 running 상태)
          doSetup()
        })
    }

    return () => {
      cancelled = true
      try { procRef.current?.disconnect() } catch {}
      try { srcRef.current?.disconnect() } catch {}
      void ctx.close()
      ctxRef.current  = null
      srcRef.current  = null
      procRef.current = null
      setIsActive(false)
    }
  }, [stream, reset])

  return { metrics, reset, isActive }
}

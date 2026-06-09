/**
 * useLoudnessMeter.ts
 *
 * ITU-R BS.1770-4 / EBU R128 준수 라우드니스 측정 훅
 *
 * ─ 변경사항 ────────────────────────────────────────────────────────────────
 *   (stream) → (audioCtx, srcNode) 시그니처 변경
 *   AudioContext를 직접 생성하지 않음 — useSharedAudio가 제공하는 단일 컨텍스트 사용
 *
 * 구현 기준:
 *   - K-weighting: 2단계 IIR (ITU-R BS.1770-4 Annex 1)
 *   - Momentary  : 400ms 슬라이딩 창
 *   - Short-term : 3s 슬라이딩 창
 *   - Integrated : Gated 전체 프로그램 LUFS
 *   - LRA        : Short-term 히스토그램 10th ~ 95th percentile
 *   - True Peak  : 4× 오버샘플링
 *
 * 비용: $0
 */

import { useRef, useState, useCallback, useEffect } from 'react'

export interface LoudnessMetrics {
  M:     number
  S:     number
  I:     number
  LRA:   number
  TP_L:  number
  TP_R:  number
  instL: number
  instR: number
}

const SILENCE: LoudnessMetrics = {
  M: -Infinity, S: -Infinity, I: -Infinity,
  LRA: 0, TP_L: -Infinity, TP_R: -Infinity,
  instL: -Infinity, instR: -Infinity,
}

// ── K-weighting IIR 계수 ──────────────────────────────────────────────────────

interface IIR2Coeffs {
  b: [number, number, number]
  a: [number, number, number]
}
interface KWeightCoeffs {
  stage1: IIR2Coeffs
  stage2: IIR2Coeffs
}

function computeKWeightCoeffs(fs: number): KWeightCoeffs {
  const fc1  = 1681.974450955533
  const Vh   = 1.584864701130855
  const K1   = Math.tan(Math.PI * fc1 / fs)
  const K1sq = K1 * K1
  const d1   = 1 + Math.SQRT2 * K1 + K1sq

  const fc2  = 38.13547087613982
  const K2   = Math.tan(Math.PI * fc2 / fs)
  const K2sq = K2 * K2
  const d2   = K2sq + Math.SQRT2 * K2 + 1

  return {
    stage1: {
      b: [
        (Vh + Vh * Math.SQRT2 * K1 + K1sq) / d1,
        (2 * (K1sq - Vh)) / d1,
        (Vh - Vh * Math.SQRT2 * K1 + K1sq) / d1,
      ],
      a: [1, (2 * (K1sq - 1)) / d1, (1 - Math.SQRT2 * K1 + K1sq) / d1],
    },
    stage2: {
      b: [1 / d2, -2 / d2, 1 / d2],
      a: [1, (2 * (K2sq - 1)) / d2, (K2sq - Math.SQRT2 * K2 + 1) / d2],
    },
  }
}

function applyIIR2(
  input: Float32Array,
  b: [number, number, number],
  a: [number, number, number],
  state: [number, number],
): Float32Array {
  const out = new Float32Array(input.length)
  let s0 = state[0], s1 = state[1]
  for (let n = 0; n < input.length; n++) {
    const x = input[n]!
    const y = b[0] * x + s0
    s0 = b[1] * x - a[1] * y + s1
    s1 = b[2] * x - a[2] * y
    out[n] = y
  }
  state[0] = s0; state[1] = s1
  return out
}

function kWeight(
  input: Float32Array,
  coeffs: KWeightCoeffs,
  s1: [number, number],
  s2: [number, number],
): Float32Array {
  return applyIIR2(applyIIR2(input, coeffs.stage1.b, coeffs.stage1.a, s1), coeffs.stage2.b, coeffs.stage2.a, s2)
}

function meanSquare(buf: Float32Array): number {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!
  return sum / buf.length
}

function msToLUFS(ms: number): number {
  return ms <= 0 ? -Infinity : -0.691 + 10 * Math.log10(ms)
}

function computeTruePeak(input: Float32Array): number {
  const OS = 4
  let peak = 0
  for (let i = 0; i < input.length - 1; i++) {
    const x0 = input[i]!, x1 = input[i + 1]!
    for (let k = 0; k < OS; k++) {
      const abs = Math.abs(x0 + (x1 - x0) * (k / OS))
      if (abs > peak) peak = abs
    }
  }
  const last = Math.abs(input[input.length - 1] ?? 0)
  if (last > peak) peak = last
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity
}

interface IntegBlock { ms: number }

function gatedIntegrated(blocks: IntegBlock[]): number {
  if (blocks.length === 0) return -Infinity
  const abs_gate = Math.pow(10, (-70 + 0.691) / 10)
  const p1 = blocks.filter(b => b.ms >= abs_gate)
  if (p1.length === 0) return -Infinity
  const avg1 = p1.reduce((s, b) => s + b.ms, 0) / p1.length
  const rel_gate = avg1 * Math.pow(10, -10 / 10)
  const p2 = p1.filter(b => b.ms >= rel_gate)
  if (p2.length === 0) return -Infinity
  return msToLUFS(p2.reduce((s, b) => s + b.ms, 0) / p2.length)
}

function computeLRA(history: number[]): number {
  const v = history.filter(isFinite).sort((a, b) => a - b)
  if (v.length < 2) return 0
  return Math.max(0, (v[Math.floor(v.length * 0.95)] ?? v[v.length - 1]!) - (v[Math.floor(v.length * 0.10)] ?? v[0]!))
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLoudnessMeter(
  audioCtx: AudioContext | null,
  srcNode:  AudioNode | null,
) {
  const procRef    = useRef<ScriptProcessorNode | null>(null)
  const kStateL1   = useRef<[number, number]>([0, 0])
  const kStateL2   = useRef<[number, number]>([0, 0])
  const kStateR1   = useRef<[number, number]>([0, 0])
  const kStateR2   = useRef<[number, number]>([0, 0])
  const coeffsRef  = useRef<KWeightCoeffs | null>(null)
  const mBufL      = useRef<number[]>([])
  const mBufR      = useRef<number[]>([])
  const sBufL      = useRef<number[]>([])
  const sBufR      = useRef<number[]>([])
  const integBlocks = useRef<IntegBlock[]>([])
  const integAccL  = useRef(0)
  const integAccR  = useRef(0)
  const integN     = useRef(0)
  const stHistory  = useRef<number[]>([])
  const tpL        = useRef(-Infinity)
  const tpR        = useRef(-Infinity)

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
    if (!audioCtx || !srcNode) {
      reset()
      return
    }

    let cancelled = false

    coeffsRef.current = computeKWeightCoeffs(audioCtx.sampleRate)

    const bufSize     = 4096
    const mWinFrames  = Math.ceil(0.400 * audioCtx.sampleRate / bufSize)
    const sWinFrames  = Math.ceil(3.000 * audioCtx.sampleRate / bufSize)
    const integFrames = Math.ceil(0.400 * audioCtx.sampleRate / bufSize)

    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const proc     = audioCtx.createScriptProcessor(bufSize, 2, 2)
    const silencer = audioCtx.createGain()
    silencer.gain.value = 0

    proc.onaudioprocess = (e) => {
      if (cancelled) return
      const coeffs = coeffsRef.current
      if (!coeffs) return

      const inL = e.inputBuffer.getChannelData(0)
      const inR = e.inputBuffer.numberOfChannels > 1
        ? e.inputBuffer.getChannelData(1)
        : e.inputBuffer.getChannelData(0)

      const kL = kWeight(inL, coeffs, kStateL1.current, kStateL2.current)
      const kR = kWeight(inR, coeffs, kStateR1.current, kStateR2.current)

      const tp_l = computeTruePeak(inL)
      const tp_r = computeTruePeak(inR)
      if (tp_l > tpL.current) tpL.current = tp_l
      if (tp_r > tpR.current) tpR.current = tp_r

      const msL = meanSquare(kL)
      const msR = meanSquare(kR)

      mBufL.current.push(msL); mBufR.current.push(msR)
      if (mBufL.current.length > mWinFrames) { mBufL.current.shift(); mBufR.current.shift() }
      const M = msToLUFS((mBufL.current.reduce((s, v) => s + v, 0) / mBufL.current.length) + (mBufR.current.reduce((s, v) => s + v, 0) / mBufR.current.length))

      sBufL.current.push(msL); sBufR.current.push(msR)
      if (sBufL.current.length > sWinFrames) { sBufL.current.shift(); sBufR.current.shift() }
      const S = msToLUFS((sBufL.current.reduce((s, v) => s + v, 0) / sBufL.current.length) + (sBufR.current.reduce((s, v) => s + v, 0) / sBufR.current.length))

      stHistory.current.push(S)
      if (stHistory.current.length > 1800) stHistory.current.shift()

      integAccL.current += msL; integAccR.current += msR; integN.current++
      if (integN.current >= integFrames) {
        integBlocks.current.push({ ms: (integAccL.current + integAccR.current) / (2 * integN.current) })
        if (integBlocks.current.length > 18000) integBlocks.current.shift()
        integAccL.current = 0; integAccR.current = 0; integN.current = 0
      }

      setMetrics({
        M, S,
        I:     gatedIntegrated(integBlocks.current),
        LRA:   computeLRA(stHistory.current),
        TP_L:  tpL.current,
        TP_R:  tpR.current,
        instL: tp_l,
        instR: tp_r,
      })
    }

    srcNode.connect(proc)
    proc.connect(silencer)
    silencer.connect(audioCtx.destination)
    procRef.current = proc
    setIsActive(true)

    return () => {
      cancelled = true
      try { proc.disconnect() } catch {}
      try { silencer.disconnect() } catch {}
      procRef.current = null
      setIsActive(false)
    }
  }, [audioCtx, srcNode, reset])

  return { metrics, reset, isActive }
}

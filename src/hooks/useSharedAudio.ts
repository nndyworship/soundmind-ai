/**
 * useSharedAudio.ts
 *
 * 단일 AudioContext + MediaStreamAudioSourceNode 공유 훅
 *
 * ─ 문제 ────────────────────────────────────────────────────────────────────
 * 각 컴포넌트(useLoudnessMeter, Goniometer, CorrelationMeter, RTA)가
 * 동일한 MediaStream에서 독립적인 AudioContext를 생성하면:
 *   - Chrome이 getDisplayMedia / getUserMedia 스트림을
 *     두 번째 이후 AudioContext에 전달하지 않는 버그
 *   - RTA AnalyserNode가 오디오 데이터를 받지 못해 완전히 침묵
 *
 * ─ 해결 ────────────────────────────────────────────────────────────────────
 *   하나의 AudioContext + 하나의 MediaStreamAudioSourceNode를 생성 후
 *   모든 처리 노드(ScriptProcessor, AnalyserNode)를 같은 srcNode에 연결.
 *   컴포넌트마다 자신의 노드만 연결/해제하고 AudioContext는 건드리지 않음.
 *
 * 비용: $0 (Web Audio API)
 */

import { useRef, useEffect, useState } from 'react'

export interface SharedAudio {
  audioCtx: AudioContext | null
  srcNode:  MediaStreamAudioSourceNode | null
}

export function useSharedAudio(stream: MediaStream | null): SharedAudio {
  const [shared, setShared] = useState<SharedAudio>({ audioCtx: null, srcNode: null })
  const ctxRef = useRef<AudioContext | null>(null)

  useEffect(() => {
    if (!stream) {
      setShared({ audioCtx: null, srcNode: null })
      return
    }

    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AudioCtx()
    ctxRef.current = ctx
    let cancelled = false

    const doSetup = () => {
      if (cancelled || ctx.state === 'closed') return

      const src = ctx.createMediaStreamSource(stream)

      // keepAlive: 컴포넌트 노드가 없어도 AudioContext가 활성 상태 유지
      const keepAlive = ctx.createGain()
      keepAlive.gain.value = 0
      src.connect(keepAlive)
      keepAlive.connect(ctx.destination)

      setShared({ audioCtx: ctx, srcNode: src })
    }

    if (ctx.state === 'running') {
      doSetup()
    } else {
      ctx.resume().then(doSetup).catch(doSetup)
    }

    return () => {
      cancelled = true
      void ctx.close()
      ctxRef.current = null
      setShared({ audioCtx: null, srcNode: null })
    }
  }, [stream])

  return shared
}

/**
 * useAudioCapture.ts
 *
 * 오디오 소스 추상화 훅
 * - Microphone : getUserMedia (일반 마이크)
 * - BlackHole  : getUserMedia + BlackHole 가상 오디오 장치 (Mac Safari)
 * - Display    : getDisplayMedia + audio (Chrome 탭 오디오)
 *
 * 비용: $0 (순수 Web Audio API)
 */

import { useState, useCallback, useRef } from 'react'

// ── 공개 타입 ──────────────────────────────────────────────────────────────────

export type AudioSourceType = 'microphone' | 'blackhole' | 'display'

export interface AudioDevice {
  deviceId:    string
  label:       string
  isBlackHole: boolean  // label에 "BlackHole" 포함 여부
}

export interface AudioCaptureState {
  stream:      MediaStream | null
  sourceType:  AudioSourceType | null
  deviceList:  AudioDevice[]
  isCapturing: boolean
  error:       string | null
}

// ── 유틸 ──────────────────────────────────────────────────────────────────────

/** 장치 레이블에서 BlackHole 여부 판별 (대소문자 무관) */
const isBlackHoleDevice = (label: string): boolean => /blackhole/i.test(label)

/** MediaDevices.enumerateDevices()로 오디오 입력 목록 조회 */
async function fetchAudioInputs(): Promise<AudioDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter(d => d.kind === 'audioinput')
    .map(d => ({
      deviceId:    d.deviceId,
      label:       d.label || `마이크 (${d.deviceId.slice(0, 6)}...)`,
      isBlackHole: isBlackHoleDevice(d.label),
    }))
}

/** 기존 스트림 모든 트랙 정지 */
function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach(t => t.stop())
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAudioCapture() {
  const currentStreamRef = useRef<MediaStream | null>(null)

  const [state, setState] = useState<AudioCaptureState>({
    stream:      null,
    sourceType:  null,
    deviceList:  [],
    isCapturing: false,
    error:       null,
  })

  /** 장치 목록 새로고침 */
  const refreshDevices = useCallback(async () => {
    try {
      // 레이블을 얻으려면 먼저 권한이 필요할 수 있음
      const list = await fetchAudioInputs()
      setState(prev => ({ ...prev, deviceList: list, error: null }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : '장치 목록 조회 실패'
      setState(prev => ({ ...prev, error: msg }))
    }
  }, [])

  /** 공통 스트림 설정 — 이전 스트림 자동 정리 */
  const setStream = useCallback(
    (stream: MediaStream, sourceType: AudioSourceType) => {
      stopStream(currentStreamRef.current)
      currentStreamRef.current = stream
      setState(prev => ({
        ...prev,
        stream,
        sourceType,
        isCapturing: true,
        error: null,
      }))
    },
    [],
  )

  /** 전체 정지 */
  const stop = useCallback(() => {
    stopStream(currentStreamRef.current)
    currentStreamRef.current = null
    setState(prev => ({
      ...prev,
      stream:      null,
      sourceType:  null,
      isCapturing: false,
      error:       null,
    }))
  }, [])

  /** 일반 마이크 시작 */
  const startMicrophone = useCallback(async (deviceId?: string) => {
    try {
      const constraints: MediaStreamConstraints = {
        audio: deviceId
          ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false }
          : { echoCancellation: false, noiseSuppression: false },
        video: false,
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)

      // 장치 목록 갱신 (레이블 권한 확보 후)
      const list = await fetchAudioInputs()
      setState(prev => ({ ...prev, deviceList: list }))
      setStream(stream, 'microphone')
    } catch (e) {
      const msg = e instanceof Error ? e.message : '마이크 접근 실패'
      setState(prev => ({
        ...prev,
        error: msg === 'Permission denied'
          ? '마이크 권한이 거부되었습니다. 브라우저 설정에서 허용해주세요.'
          : msg,
        isCapturing: false,
      }))
    }
  }, [setStream])

  /** BlackHole 가상 장치 시작 (Mac Safari) */
  const startBlackHole = useCallback(async (deviceId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId:         { exact: deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl:  false,
          // 48000Hz 또는 44100Hz — BlackHole은 둘 다 지원
        },
        video: false,
      })
      setStream(stream, 'blackhole')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'BlackHole 접근 실패'
      setState(prev => ({
        ...prev,
        error: `BlackHole 오류: ${msg}. 시스템 환경설정 → 사운드 → 출력: 멀티출력장치 확인.`,
        isCapturing: false,
      }))
    }
  }, [setStream])

  /**
   * 탭/화면 오디오 캡처 (Chrome 전용)
   * Safari는 getDisplayMedia audio 지원 안 함 → BlackHole 사용
   */
  const startDisplay = useCallback(async () => {
    // getDisplayMedia 지원 여부 체크
    if (!('getDisplayMedia' in navigator.mediaDevices)) {
      setState(prev => ({
        ...prev,
        error: 'getDisplayMedia가 지원되지 않습니다. Chrome을 사용하거나 BlackHole을 이용하세요.',
        isCapturing: false,
      }))
      return
    }

    try {
      // TypeScript DOM lib 타입 부재 — 런타임 캐스팅
      const md = navigator.mediaDevices as MediaDevices & {
        getDisplayMedia(c: MediaStreamConstraints): Promise<MediaStream>
      }
      const stream = await md.getDisplayMedia({
        audio: true,
        video: true,  // Chrome은 audio-only getDisplayMedia를 지원하지 않음
      })

      // 비디오 트랙은 즉시 정지 (오디오만 필요)
      stream.getVideoTracks().forEach(t => t.stop())

      const audioTracks = stream.getAudioTracks()
      if (audioTracks.length === 0) {
        setState(prev => ({
          ...prev,
          error: '탭 오디오를 캡처할 수 없습니다. 탭 공유 시 "오디오 공유" 체크박스를 선택하세요.',
          isCapturing: false,
        }))
        return
      }

      setStream(stream, 'display')
    } catch (e) {
      const msg = e instanceof Error ? e.message : '화면 캡처 실패'
      setState(prev => ({
        ...prev,
        error: msg.includes('Permission denied') || msg.includes('NotAllowedError')
          ? '화면 공유 권한이 거부되었습니다.'
          : msg,
        isCapturing: false,
      }))
    }
  }, [setStream])

  return {
    state,
    startMicrophone,
    startBlackHole,
    startDisplay,
    stop,
    refreshDevices,
  }
}

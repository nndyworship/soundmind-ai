/**
 * AudioSourceSelector.tsx — 오디오 소스 선택 UI (반응형)
 *
 * - 마이크 목록 드롭다운 (enumerateDevices)
 * - BlackHole 감지 시 ★ 권장 배지
 * - BlackHole 없으면 설치 안내 섹션 (접기/펼치기)
 * - Chrome 감지 시 "탭 오디오 캡처" 버튼 표시
 * - 마운트 시 장치 목록 자동 로드
 * - isMobile 반응형 지원
 *
 * 비용: $0
 */

import { useState, useEffect } from 'react'
import type { AudioCaptureState } from '../../hooks/useAudioCapture'

interface AudioSourceSelectorProps {
  state:             AudioCaptureState
  onStartMicrophone: (deviceId?: string) => Promise<void>
  onStartBlackHole:  (deviceId: string)  => Promise<void>
  onStartDisplay:    () => Promise<void>
  onStop:            () => void
  onRefresh:         () => Promise<void>
  isMobile?:         boolean
}

const isChrome = /chrome/i.test(navigator.userAgent) && !/edg/i.test(navigator.userAgent)

export default function AudioSourceSelector({
  state,
  onStartMicrophone,
  onStartBlackHole,
  onStartDisplay,
  onStop,
  onRefresh,
  isMobile = false,
}: AudioSourceSelectorProps) {
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')
  const [showGuide, setShowGuide]               = useState(false)

  // 마운트 시 장치 목록 자동 로드
  useEffect(() => {
    void onRefresh()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const blackholeDevices = state.deviceList.filter(d => d.isBlackHole)
  const regularDevices   = state.deviceList.filter(d => !d.isBlackHole)
  const hasBlackHole     = blackholeDevices.length > 0

  const handleStart = async () => {
    const bhDevice = blackholeDevices.find(d =>
      !selectedDeviceId || d.deviceId === selectedDeviceId
    )
    if (bhDevice) {
      await onStartBlackHole(bhDevice.deviceId)
    } else if (selectedDeviceId) {
      await onStartMicrophone(selectedDeviceId)
    } else {
      await onStartMicrophone()
    }
  }

  const sourceLabel: Record<string, string> = {
    microphone: '마이크',
    blackhole:  'BlackHole',
    display:    '탭 오디오',
  }

  const PAD = isMobile ? '8px 12px' : '10px 16px'

  return (
    <div style={{
      background:   'var(--clarity-panel, #141418)',
      border:       '1px solid var(--clarity-border, #2a2a30)',
      borderRadius: isMobile ? 8 : 10,
      overflow:     'hidden',
    }}>
      {/* 헤더 */}
      <div style={{
        display:        'flex',
        justifyContent: 'space-between',
        alignItems:     'center',
        padding:        PAD,
        borderBottom:   '1px solid var(--clarity-border, #2a2a30)',
      }}>
        <span style={{
          fontFamily:    'JetBrains Mono, monospace',
          fontSize:      isMobile ? 10 : 11,
          fontWeight:    700,
          letterSpacing: 1.5,
          color:         'var(--clarity-ok, #00c853)',
        }}>
          AUDIO SOURCE
        </span>

        {/* 활성 소스 인디케이터 */}
        {state.isCapturing && state.sourceType && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--clarity-ok, #00c853)',
              display: 'inline-block',
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
            <span style={{
              fontSize:   isMobile ? 10 : 11,
              color:      'var(--clarity-ok, #00c853)',
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              {sourceLabel[state.sourceType] ?? state.sourceType} ACTIVE
            </span>
          </div>
        )}
      </div>

      <div style={{
        padding:       isMobile ? '10px 12px' : '12px 16px',
        display:       'flex',
        flexDirection: 'column',
        gap:           8,
      }}>

        {/* 에러 메시지 */}
        {state.error && (
          <div style={{
            background:   'rgba(255,23,68,.08)',
            border:       '1px solid #ff1744',
            borderRadius: 6,
            padding:      '8px 12px',
            fontSize:     isMobile ? 11 : 12,
            color:        '#ff1744',
            fontFamily:   'monospace',
            lineHeight:   1.6,
          }}>
            {state.error}
          </div>
        )}

        {/* 장치 선택 드롭다운 + 새로고침 */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
            <select
              value={selectedDeviceId}
              onChange={e => setSelectedDeviceId(e.target.value)}
              style={{
                width:        '100%',
                minHeight:    isMobile ? 44 : 40,
                background:   'var(--clarity-bg, #0d0d10)',
                border:       '1px solid var(--clarity-border, #2a2a30)',
                borderRadius: 6,
                color:        '#f5f5f5',
                fontSize:     isMobile ? 11 : 12,
                fontFamily:   'JetBrains Mono, monospace',
                padding:      '0 10px',
                cursor:       'pointer',
                appearance:   'none',
              }}
            >
              <option value="">— 기본 입력 장치 —</option>

              {blackholeDevices.map(d => (
                <option key={d.deviceId} value={d.deviceId}>
                  ★ {d.label} (BlackHole 권장)
                </option>
              ))}

              {regularDevices.length > 0 && (
                <optgroup label="일반 마이크">
                  {regularDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>

          {/* 새로고침 */}
          <button
            onClick={() => { void onRefresh() }}
            title="장치 목록 새로고침"
            style={{
              minWidth:       isMobile ? 44 : 40,
              minHeight:      isMobile ? 44 : 40,
              background:     'var(--clarity-bg, #0d0d10)',
              border:         '1px solid var(--clarity-border, #2a2a30)',
              borderRadius:   6,
              color:          'rgba(255,255,255,0.5)',
              fontSize:       16,
              cursor:         'pointer',
              display:        'flex',
              alignItems:     'center',
              justifyContent: 'center',
              flexShrink:     0,
            }}
          >
            ↻
          </button>
        </div>

        {/* BlackHole 없음 안내 (접기/펼치기) */}
        {!hasBlackHole && (
          <div>
            <button
              onClick={() => setShowGuide(p => !p)}
              style={{
                background:    'transparent',
                border:        '1px solid rgba(255,214,0,0.5)',
                borderRadius:  showGuide ? '6px 6px 0 0' : 6,
                color:         '#ffd600',
                fontSize:      isMobile ? 10 : 11,
                fontFamily:    'JetBrains Mono, monospace',
                padding:       isMobile ? '7px 10px' : '6px 12px',
                cursor:        'pointer',
                width:         '100%',
                textAlign:     'left',
                letterSpacing: 0.5,
                minHeight:     36,
              }}
            >
              ⚠ BlackHole 미감지 — 시스템 오디오 캡처 방법 {showGuide ? '▲' : '▼'}
            </button>

            {showGuide && (
              <div style={{
                background:   'rgba(255,214,0,0.04)',
                border:       '1px solid rgba(255,214,0,0.2)',
                borderTop:    'none',
                borderRadius: '0 0 6px 6px',
                padding:      '10px 14px',
                fontSize:     isMobile ? 10 : 11,
                fontFamily:   'monospace',
                color:        'rgba(255,255,255,0.55)',
                lineHeight:   1.9,
              }}>
                <div style={{ color: '#ffd600', marginBottom: 6, fontWeight: 700, fontSize: isMobile ? 10 : 11 }}>
                  BlackHole 2ch 설치 가이드
                </div>
                {[
                  '1. brew install blackhole-2ch (또는 existinginstall.com/blackhole)',
                  '2. 설치 후 재부팅',
                  '3. 오디오 MIDI 설정 → Multi-Output Device 생성',
                  '4. 내장 스피커 + BlackHole 2ch 체크',
                  '5. 이 페이지 새로고침 → BlackHole 선택',
                ].map((step, i) => (
                  <div key={i} style={{ marginBottom: 2 }}>{step}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 시작 / 정지 버튼 행 */}
        <div style={{ display: 'flex', gap: 8 }}>
          {!state.isCapturing ? (
            <button
              onClick={() => { void handleStart() }}
              style={{
                flex:          1,
                minHeight:     isMobile ? 52 : 56,
                background:    'rgba(0,200,83,.10)',
                border:        '1px solid #00c853',
                borderRadius:  8,
                color:         '#00c853',
                fontFamily:    'JetBrains Mono, monospace',
                fontSize:      isMobile ? 13 : 14,
                fontWeight:    700,
                cursor:        'pointer',
                letterSpacing: 1,
              }}
            >
              {hasBlackHole ? '★ BlackHole 시작' : '마이크 시작'}
            </button>
          ) : (
            <button
              onClick={onStop}
              style={{
                flex:          1,
                minHeight:     isMobile ? 52 : 56,
                background:    'rgba(255,23,68,.10)',
                border:        '1px solid #ff1744',
                borderRadius:  8,
                color:         '#ff1744',
                fontFamily:    'JetBrains Mono, monospace',
                fontSize:      isMobile ? 13 : 14,
                fontWeight:    700,
                cursor:        'pointer',
                letterSpacing: 1,
              }}
            >
              ■ 정지
            </button>
          )}

          {/* Chrome 전용: 탭 오디오 캡처 */}
          {isChrome && !state.isCapturing && (
            <button
              onClick={() => { void onStartDisplay() }}
              style={{
                flex:          isMobile ? 0.8 : 1,
                minHeight:     isMobile ? 52 : 56,
                background:    'rgba(10,132,255,.10)',
                border:        '1px solid #0a84ff',
                borderRadius:  8,
                color:         '#0a84ff',
                fontFamily:    'JetBrains Mono, monospace',
                fontSize:      isMobile ? 10 : 12,
                fontWeight:    700,
                cursor:        'pointer',
                letterSpacing: 0.5,
                lineHeight:    1.4,
              }}
            >
              탭 오디오{isMobile ? '' : <br />}캡처
            </button>
          )}
        </div>

      </div>
    </div>
  )
}

import { useRef, useEffect } from 'react'

interface Props {
  spectrumData: Float32Array | null   // ArrayBufferLike 포함 (strict 호환)
  peakFreq: number | null
  sampleRate: number
  fftSize?: number
}

const LOG_MIN = Math.log10(20)
const LOG_MAX = Math.log10(20000)
const DB_MIN  = -90
const DB_MAX  = 0
const X_LABELS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]

function freqToX(freq: number, width: number): number {
  return ((Math.log10(freq) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * width
}

function dbToY(db: number, height: number): number {
  return height - ((db - DB_MIN) / (DB_MAX - DB_MIN)) * height
}

export default function SpectrumDisplay({ spectrumData, peakFreq, sampleRate, fftSize = 8192 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height
    ctx.clearRect(0, 0, W, H)

    // 배경
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, W, H)

    // 그리드 라인 (수평 dB)
    ctx.strokeStyle = '#1a1a1a'
    ctx.lineWidth = 1
    ;[-80, -60, -40, -20, -10].forEach(db => {
      const y = dbToY(db, H - 30)
      ctx.beginPath()
      ctx.moveTo(40, y)
      ctx.lineTo(W, y)
      ctx.stroke()
      ctx.fillStyle = '#3a3a3a'
      ctx.font = '10px JetBrains Mono, monospace'
      ctx.fillText(`${db}`, 2, y + 4)
    })

    // X축 레이블
    ctx.fillStyle = '#3a3a3a'
    ctx.font = '10px JetBrains Mono, monospace'
    X_LABELS.forEach(freq => {
      const x = freqToX(freq, W - 40) + 40
      ctx.fillText(freq >= 1000 ? `${freq / 1000}k` : `${freq}`, x - 8, H - 6)
    })

    if (!spectrumData) {
      // 대기 상태
      ctx.fillStyle = '#1f1f1f'
      ctx.font = '14px JetBrains Mono, monospace'
      ctx.textAlign = 'center'
      ctx.fillText('마이크 시작 버튼을 눌러 스펙트럼 분석을 시작하세요', W / 2, H / 2)
      ctx.textAlign = 'left'
      return
    }

    const binWidth  = sampleRate / fftSize
    const binCount  = spectrumData.length
    const plotW     = W - 40
    const plotH     = H - 30

    // 스펙트럼 바 렌더링
    for (let i = 1; i < binCount; i++) {
      const freq    = i * binWidth
      if (freq < 20 || freq > 20000) continue

      const x1 = freqToX(freq - binWidth, plotW) + 40
      const x2 = freqToX(freq, plotW) + 40
      const db  = spectrumData[i]
      const y   = dbToY(Math.max(db, DB_MIN), plotH)

      // 강도에 따른 색상
      if (db > -10) ctx.fillStyle = '#ff3b30'
      else if (db > -20) ctx.fillStyle = '#ffb300'
      else ctx.fillStyle = '#00ff88'

      ctx.fillRect(x1, y, Math.max(x2 - x1, 1), plotH - y)
    }

    // 피크 주파수 수직선
    if (peakFreq && peakFreq > 20 && peakFreq < 20000) {
      const px = freqToX(peakFreq, plotW) + 40
      ctx.strokeStyle = '#ff3b30'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.beginPath()
      ctx.moveTo(px, 0)
      ctx.lineTo(px, plotH)
      ctx.stroke()
      ctx.setLineDash([])

      const label = peakFreq >= 1000 ? `${(peakFreq / 1000).toFixed(2)}kHz` : `${Math.round(peakFreq)}Hz`
      ctx.fillStyle = '#ff3b30'
      ctx.font = 'bold 11px JetBrains Mono, monospace'
      ctx.fillText(label, Math.min(px + 4, W - 70), 16)
    }
  }, [spectrumData, peakFreq, sampleRate, fftSize])

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={220}
      style={{ width: '100%', height: '220px', display: 'block' }}
    />
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'
import QRCode from 'qrcode'

type CardStyle = 'branded' | 'minimal'

type Props = {
  shareUrl: string
  albumTitle: string
  onClose: () => void
}

const DEFAULT_TITLE = 'CAPTURE THE MOMENT'
const DEFAULT_BODY = 'Scan the QR code with your camera to upload your photos and videos.'

function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line)
      line = word
    } else {
      line = test
    }
  }
  if (line) lines.push(line)
  return lines
}

async function renderTableCard(
  canvas: HTMLCanvasElement,
  title: string,
  body: string,
  style: CardStyle,
  shareUrl: string,
  width: number,
): Promise<void> {
  const W = width
  const H = Math.round(W * (1700 / 1200))
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const s = W / 1200
  const BRANDED = style === 'branded'

  ctx.fillStyle = BRANDED ? '#FDFAF5' : '#FFFFFF'
  ctx.fillRect(0, 0, W, H)

  let yPos = 0

  if (BRANDED) {
    const headerH = Math.round(220 * s)
    ctx.fillStyle = '#254F22'
    ctx.fillRect(0, 0, W, headerH)
    ctx.fillStyle = '#FDFAF5'
    ctx.font = `bold ${Math.round(80 * s)}px Georgia, "Times New Roman", serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('HUSHARE', W / 2, headerH / 2)
    yPos = headerH + Math.round(70 * s)
  } else {
    yPos = Math.round(110 * s)
  }

  // Title
  ctx.textBaseline = 'top'
  const titleSize = Math.round(84 * s)
  ctx.font = `bold ${titleSize}px Georgia, "Times New Roman", serif`
  ctx.fillStyle = BRANDED ? '#254F22' : '#111111'
  ctx.textAlign = 'center'
  const titleLines = wrapTextLines(ctx, (title || DEFAULT_TITLE).toUpperCase(), W * 0.80)
  const titleLineH = Math.round(titleSize * 1.22)
  for (const line of titleLines) {
    ctx.fillText(line, W / 2, yPos)
    yPos += titleLineH
  }
  yPos += Math.round(32 * s)

  // Decorative line
  ctx.strokeStyle = BRANDED ? '#C5A882' : '#CCCCCC'
  ctx.lineWidth = Math.round(2 * s)
  const lineW = Math.round(380 * s)
  ctx.beginPath()
  ctx.moveTo((W - lineW) / 2, yPos)
  ctx.lineTo((W + lineW) / 2, yPos)
  ctx.stroke()
  yPos += Math.round(44 * s)

  // Body text
  const bodySize = Math.round(43 * s)
  ctx.font = `${bodySize}px Georgia, "Times New Roman", serif`
  ctx.fillStyle = BRANDED ? '#5C3D2E' : '#555555'
  const bodyLines = wrapTextLines(ctx, body || DEFAULT_BODY, W * 0.72)
  const bodyLineH = Math.round(bodySize * 1.6)
  for (const line of bodyLines) {
    ctx.fillText(line, W / 2, yPos)
    yPos += bodyLineH
  }
  yPos += Math.round(55 * s)

  // QR code — fills remaining space above footer
  const footerReserve = Math.round(130 * s)
  const maxQr = Math.round(420 * s)
  const qrSize = Math.min(maxQr, H - yPos - footerReserve)
  if (qrSize > 40) {
    const qrDataUrl = await QRCode.toDataURL(shareUrl, {
      width: qrSize,
      margin: 1,
      color: { dark: BRANDED ? '#254F22' : '#000000', light: '#FFFFFF' },
    })
    const qrImg = new Image()
    await new Promise<void>((resolve, reject) => {
      qrImg.onload = () => resolve()
      qrImg.onerror = () => reject(new Error('QR render failed'))
      qrImg.src = qrDataUrl
    })
    ctx.drawImage(qrImg, (W - qrSize) / 2, yPos, qrSize, qrSize)
  }

  // Footer
  ctx.font = `${Math.round(34 * s)}px Georgia, "Times New Roman", serif`
  ctx.fillStyle = BRANDED ? '#8B6F4E' : '#999999'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('hushare.space', W / 2, H - Math.round(55 * s))
}

export default function TableCardModal({ shareUrl, albumTitle, onClose }: Props) {
  const [title, setTitle] = useState(DEFAULT_TITLE)
  const [body, setBody] = useState(DEFAULT_BODY)
  const [style, setStyle] = useState<CardStyle>('branded')
  const [downloading, setDownloading] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (canvasRef.current) {
      renderTableCard(canvasRef.current, title, body, style, shareUrl, 280)
    }
  }, [title, body, style, shareUrl])

  async function handleDownload() {
    setDownloading(true)
    try {
      const offscreen = document.createElement('canvas')
      await renderTableCard(offscreen, title, body, style, shareUrl, 1200)
      const link = document.createElement('a')
      link.download = `${(albumTitle || 'album').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-table-card.png`
      link.href = offscreen.toDataURL('image/png')
      link.click()
    } finally {
      setDownloading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 10,
    border: '1px solid #DDD5C5',
    background: '#FDFAF5',
    color: '#254F22',
    fontSize: 13,
    outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="relative rounded-2xl shadow-2xl overflow-y-auto"
        style={{ background: '#FFFFFF', width: '100%', maxWidth: 640, maxHeight: '95dvh', padding: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="font-semibold text-sm" style={{ color: '#254F22' }}>Table card</span>
          <button onClick={onClose} style={{ color: '#A89880' }}><X className="w-4 h-4" /></button>
        </div>

        <div className="flex gap-4 flex-col sm:flex-row">
          {/* Controls */}
          <div className="flex-1 space-y-3">
            {/* Style selector */}
            <div>
              <p className="text-xs font-semibold mb-1.5" style={{ color: '#7C5C3E' }}>Style</p>
              <div className="flex gap-2">
                {(['branded', 'minimal'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStyle(s)}
                    className="flex-1 text-xs font-semibold rounded-lg py-2 transition"
                    style={{
                      background: style === s ? '#254F22' : '#F5F0E8',
                      color: style === s ? '#FDFAF5' : '#5C3D2E',
                      border: '1px solid ' + (style === s ? '#254F22' : '#DDD5C5'),
                    }}
                  >
                    {s === 'branded' ? 'Hushare branded' : 'Minimal (B&W)'}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <div>
              <p className="text-xs font-semibold mb-1.5" style={{ color: '#7C5C3E' }}>Heading</p>
              <input
                style={inputStyle}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={60}
                placeholder={DEFAULT_TITLE}
              />
            </div>

            {/* Body */}
            <div>
              <p className="text-xs font-semibold mb-1.5" style={{ color: '#7C5C3E' }}>Description</p>
              <textarea
                style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={200}
                placeholder={DEFAULT_BODY}
              />
            </div>

            <button
              onClick={handleDownload}
              disabled={downloading}
              className="w-full flex items-center justify-center gap-2 font-semibold rounded-xl py-3 transition hover:opacity-90 disabled:opacity-50"
              style={{ background: '#254F22', color: '#FDFAF5' }}
            >
              <Download className="w-4 h-4" />
              {downloading ? 'Generating…' : 'Download PNG (print-ready)'}
            </button>

            <p className="text-xs text-center" style={{ color: '#A89880' }}>
              1200 × 1700 px — works for A5 / 5×7&quot; table cards
            </p>
          </div>

          {/* Preview */}
          <div className="flex-none flex flex-col items-center">
            <p className="text-xs font-semibold mb-1.5" style={{ color: '#7C5C3E' }}>Preview</p>
            <canvas
              ref={canvasRef}
              style={{ width: 180, height: Math.round(180 * 1700 / 1200), borderRadius: 8, border: '1px solid #DDD5C5' }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

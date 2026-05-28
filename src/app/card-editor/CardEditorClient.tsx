'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, Download, ImagePlus } from 'lucide-react'
import QRCode from 'qrcode'

type FontChoice = 'playfair' | 'sans' | 'hand'
type QRPos = 'bottom' | 'middle'

type Config = {
  heading: string
  body: string
  bgColor: string
  accentColor: string
  textColor: string
  bodyColor: string
  qrColor: string
  font: FontChoice
  qrPos: QRPos
  showFooter: boolean
  logoDataUrl: string | null
}

const DEFAULTS: Config = {
  heading: '',
  body: 'Scan the QR code with your camera to upload your photos and videos.',
  bgColor: '#FFFFFF',
  accentColor: '#254F22',
  textColor: '#111111',
  bodyColor: '#555555',
  qrColor: '#111111',
  font: 'playfair',
  qrPos: 'bottom',
  showFooter: true,
  logoDataUrl: null,
}

function fontStack(f: FontChoice, size: number, bold = false, italic = false) {
  const w = bold ? 'bold ' : ''
  const i = italic ? 'italic ' : ''
  if (f === 'playfair') return `${w}${i}${size}px 'Playfair Display', Georgia, serif`
  if (f === 'hand') return `${w}${i}${size}px 'Playwrite GB J', cursive`
  return `${w}${i}${size}px 'Geist', system-ui, -apple-system, sans-serif`
}

async function ensureFonts(font: FontChoice) {
  if (typeof document === 'undefined' || !document.fonts) return
  try {
    const names: Record<FontChoice, string> = {
      playfair: "'Playfair Display'",
      hand: "'Playwrite GB J'",
      sans: "'Geist'",
    }
    const n = names[font]
    await Promise.all([
      document.fonts.load(`bold 72px ${n}`),
      document.fonts.load(`400 72px ${n}`),
    ])
  } catch { /* ignore */ }
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('img load failed'))
    img.src = src
  })
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const test = line ? `${line} ${w}` : w
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w }
    else line = test
  }
  if (line) lines.push(line)
  return lines
}

export async function renderCustomCard(canvas: HTMLCanvasElement, cfg: Config, shareUrl: string, W: number) {
  const H = Math.round(W * (1700 / 1200))
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const s = W / 1200

  await ensureFonts(cfg.font)

  // Background
  ctx.fillStyle = cfg.bgColor
  ctx.fillRect(0, 0, W, H)

  let y = Math.round(80 * s)
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'

  // Optional logo
  if (cfg.logoDataUrl) {
    try {
      const logo = await loadImg(cfg.logoDataUrl)
      const maxH = Math.round(140 * s), maxW = Math.round(540 * s)
      const sc = Math.min(maxH / logo.naturalHeight, maxW / logo.naturalWidth)
      const lw = logo.naturalWidth * sc, lh = logo.naturalHeight * sc
      ctx.drawImage(logo, (W - lw) / 2, y, lw, lh)
      y += Math.round(lh + 50 * s)
    } catch { /* skip */ }
  }

  // QR at top (if qrPos === 'middle', show after heading)
  const qrMaxSz = Math.round(460 * s)
  const qrReserve = Math.round(140 * s)

  if (cfg.qrPos === 'bottom') {
    // Heading
    const hsz = Math.round(80 * s)
    ctx.font = fontStack(cfg.font, hsz, true)
    ctx.fillStyle = cfg.textColor
    for (const l of wrap(ctx, cfg.heading || 'Capture the Moment', W * 0.82)) {
      ctx.fillText(l, W / 2, y); y += Math.round(hsz * 1.24)
    }
    y += Math.round(28 * s)

    // Accent line
    ctx.strokeStyle = cfg.accentColor; ctx.lineWidth = Math.round(3 * s)
    const rw = Math.round(240 * s)
    ctx.beginPath(); ctx.moveTo((W - rw) / 2, y); ctx.lineTo((W + rw) / 2, y); ctx.stroke()
    y += Math.round(38 * s)

    // Body
    const bsz = Math.round(40 * s)
    ctx.font = fontStack(cfg.font, bsz)
    ctx.fillStyle = cfg.bodyColor
    for (const l of wrap(ctx, cfg.body, W * 0.72)) { ctx.fillText(l, W / 2, y); y += Math.round(bsz * 1.68) }
    y += Math.round(50 * s)

    // QR
    const footerH = cfg.showFooter ? Math.round(100 * s) : Math.round(40 * s)
    const qrSz = Math.min(qrMaxSz, H - y - footerH)
    if (qrSz > 30) {
      const du = await QRCode.toDataURL(shareUrl, { width: qrSz, margin: 1, color: { dark: cfg.qrColor, light: cfg.bgColor } })
      ctx.drawImage(await loadImg(du), (W - qrSz) / 2, y, qrSz, qrSz)
    }
  } else {
    // Heading first (smaller)
    const hsz = Math.round(68 * s)
    ctx.font = fontStack(cfg.font, hsz, true)
    ctx.fillStyle = cfg.textColor
    for (const l of wrap(ctx, cfg.heading || 'Capture the Moment', W * 0.82)) {
      ctx.fillText(l, W / 2, y); y += Math.round(hsz * 1.24)
    }
    y += Math.round(22 * s)

    // Accent line
    ctx.strokeStyle = cfg.accentColor; ctx.lineWidth = Math.round(3 * s)
    const rw = Math.round(240 * s)
    ctx.beginPath(); ctx.moveTo((W - rw) / 2, y); ctx.lineTo((W + rw) / 2, y); ctx.stroke()
    y += Math.round(36 * s)

    // Large QR in middle
    const bodyReserve = Math.round(280 * s)
    const footerH = cfg.showFooter ? Math.round(100 * s) : Math.round(40 * s)
    const qrSz = Math.min(qrMaxSz, H - y - bodyReserve - footerH)
    if (qrSz > 30) {
      const du = await QRCode.toDataURL(shareUrl, { width: qrSz, margin: 1, color: { dark: cfg.qrColor, light: cfg.bgColor } })
      ctx.drawImage(await loadImg(du), (W - qrSz) / 2, y, qrSz, qrSz)
      y += Math.round(qrSz + 44 * s)
    }

    // Body below QR
    const bsz = Math.round(40 * s)
    ctx.font = fontStack(cfg.font, bsz)
    ctx.fillStyle = cfg.bodyColor
    for (const l of wrap(ctx, cfg.body, W * 0.72)) { ctx.fillText(l, W / 2, y); y += Math.round(bsz * 1.68) }
  }

  if (cfg.showFooter) {
    ctx.font = fontStack(cfg.font, Math.round(30 * s))
    ctx.fillStyle = cfg.bodyColor + '80'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText('hushare.space', W / 2, H - Math.round(46 * s))
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const inputCls = 'w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1'
const inputStyle = { background: '#FAFAFA', borderColor: '#E0E0E0', color: '#1A1A1A' }

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold mb-1.5" style={{ color: '#555555' }}>{children}</p>
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs" style={{ color: '#555555' }}>{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono" style={{ color: '#888' }}>{value}</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="rounded cursor-pointer"
          style={{ width: 32, height: 28, border: '1px solid #E0E0E0', padding: 2, background: 'none' }}
        />
      </div>
    </div>
  )
}

export default function CardEditorClient() {
  const params = useSearchParams()
  const shareUrl = params.get('url') ?? ''
  const initialTitle = params.get('title') ?? ''

  const [cfg, setCfg] = useState<Config>({ ...DEFAULTS, heading: initialTitle })
  const [downloading, setDownloading] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const set = useCallback(<K extends keyof Config>(key: K, val: Config[K]) => {
    setCfg((prev) => ({ ...prev, [key]: val }))
  }, [])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !shareUrl) return
    renderCustomCard(c, cfg, shareUrl, 260)
  }, [cfg, shareUrl])

  async function handleDownload() {
    if (!shareUrl) return
    setDownloading(true)
    try {
      const off = document.createElement('canvas')
      await renderCustomCard(off, cfg, shareUrl, 1200)
      const link = document.createElement('a')
      link.download = `${(cfg.heading || 'card').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-table-card.png`
      link.href = off.toDataURL('image/png')
      link.click()
    } finally {
      setDownloading(false)
    }
  }

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => set('logoDataUrl', (ev.target?.result as string) ?? null)
    reader.readAsDataURL(file)
  }

  const previewH = Math.round(260 * 1700 / 1200)

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#F5F5F5', fontFamily: 'system-ui, sans-serif' }}>
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-5 py-3 sticky top-0 z-10"
        style={{ background: '#FFFFFF', borderBottom: '1px solid #E5E5E5' }}
      >
        <button
          onClick={() => window.close()}
          className="flex items-center gap-1.5 text-sm font-medium"
          style={{ color: '#555555' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Close
        </button>
        <span className="text-sm font-semibold" style={{ color: '#1A1A1A' }}>Card Editor</span>
        <button
          onClick={handleDownload}
          disabled={downloading || !shareUrl}
          className="flex items-center gap-1.5 text-sm font-semibold rounded-xl px-4 py-2 transition hover:opacity-90 disabled:opacity-40"
          style={{ background: '#254F22', color: '#FDFAF5' }}
        >
          <Download className="w-4 h-4" />
          {downloading ? 'Generating…' : 'Download PNG'}
        </button>
      </div>

      <div className="flex flex-col lg:flex-row gap-5 p-5 flex-1">
        {/* Controls */}
        <div
          className="rounded-2xl p-5 space-y-5 lg:w-72 shrink-0"
          style={{ background: '#FFFFFF', border: '1px solid #E5E5E5' }}
        >
          {/* Text */}
          <div className="space-y-3">
            <Label>Heading</Label>
            <input
              className={inputCls}
              style={inputStyle}
              value={cfg.heading}
              onChange={(e) => set('heading', e.target.value)}
              maxLength={70}
              placeholder="Capture the Moment"
            />
            <Label>Description</Label>
            <textarea
              className={inputCls}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 72 }}
              value={cfg.body}
              onChange={(e) => set('body', e.target.value)}
              maxLength={220}
            />
          </div>

          <hr style={{ borderColor: '#F0F0F0' }} />

          {/* Font */}
          <div>
            <Label>Font</Label>
            <div className="flex gap-1.5">
              {(['playfair', 'sans', 'hand'] as FontChoice[]).map((f) => (
                <button
                  key={f}
                  onClick={() => set('font', f)}
                  className="flex-1 text-xs font-semibold rounded-lg py-2 transition"
                  style={{
                    background: cfg.font === f ? '#254F22' : '#F5F0E8',
                    color: cfg.font === f ? '#FDFAF5' : '#5C3D2E',
                    border: '1px solid ' + (cfg.font === f ? '#254F22' : '#DDD5C5'),
                  }}
                >
                  {f === 'playfair' ? 'Serif' : f === 'sans' ? 'Sans' : 'Script'}
                </button>
              ))}
            </div>
          </div>

          {/* Colors */}
          <div className="space-y-2.5">
            <Label>Colors</Label>
            <ColorRow label="Background" value={cfg.bgColor} onChange={(v) => set('bgColor', v)} />
            <ColorRow label="Heading" value={cfg.textColor} onChange={(v) => set('textColor', v)} />
            <ColorRow label="Body text" value={cfg.bodyColor} onChange={(v) => set('bodyColor', v)} />
            <ColorRow label="Accent" value={cfg.accentColor} onChange={(v) => set('accentColor', v)} />
            <ColorRow label="QR code" value={cfg.qrColor} onChange={(v) => set('qrColor', v)} />
          </div>

          <hr style={{ borderColor: '#F0F0F0' }} />

          {/* Layout */}
          <div>
            <Label>QR position</Label>
            <div className="flex gap-1.5">
              {(['bottom', 'middle'] as QRPos[]).map((p) => (
                <button
                  key={p}
                  onClick={() => set('qrPos', p)}
                  className="flex-1 text-xs font-semibold rounded-lg py-2 transition"
                  style={{
                    background: cfg.qrPos === p ? '#254F22' : '#F5F0E8',
                    color: cfg.qrPos === p ? '#FDFAF5' : '#5C3D2E',
                    border: '1px solid ' + (cfg.qrPos === p ? '#254F22' : '#DDD5C5'),
                  }}
                >
                  {p === 'bottom' ? 'QR bottom' : 'QR center'}
                </button>
              ))}
            </div>
          </div>

          {/* Logo upload */}
          <div>
            <Label>Logo / image (optional)</Label>
            <label
              className="flex items-center justify-center gap-2 w-full rounded-xl py-2.5 text-xs font-semibold cursor-pointer transition hover:opacity-80"
              style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px dashed #DDD5C5' }}
            >
              <ImagePlus className="w-3.5 h-3.5" />
              {cfg.logoDataUrl ? 'Change image' : 'Upload PNG / JPG'}
              <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
            </label>
            {cfg.logoDataUrl && (
              <button
                onClick={() => set('logoDataUrl', null)}
                className="mt-1.5 text-xs w-full text-center"
                style={{ color: '#A89880' }}
              >
                Remove image
              </button>
            )}
          </div>

          {/* Footer toggle */}
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={cfg.showFooter}
              onChange={(e) => set('showFooter', e.target.checked)}
              className="rounded"
            />
            <span className="text-xs" style={{ color: '#555555' }}>Show &quot;hushare.space&quot; footer</span>
          </label>
        </div>

        {/* Canvas preview */}
        <div className="flex-1 flex flex-col items-center gap-3">
          <p className="text-xs font-semibold" style={{ color: '#888' }}>Live preview</p>
          <canvas
            ref={canvasRef}
            style={{
              width: 260,
              height: previewH,
              borderRadius: 12,
              border: '1px solid #E0E0E0',
              boxShadow: '0 4px 24px rgba(0,0,0,0.10)',
            }}
          />
          <p className="text-xs" style={{ color: '#AAAAAA' }}>
            Download renders at 1200×1700 px — A5 / 5×7&quot; print-ready
          </p>
        </div>
      </div>
    </div>
  )
}

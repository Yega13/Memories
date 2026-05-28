'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Download, ImagePlus } from 'lucide-react'
import QRCode from 'qrcode'

type FontChoice = 'playfair' | 'sans' | 'hand'
type QRPos = 'bottom' | 'center'
type BorderStyle = 'none' | 'thin' | 'double'
type QRSize = 'sm' | 'md' | 'lg'

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
  qrSize: QRSize
  border: BorderStyle
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
  qrSize: 'md',
  border: 'none',
  showFooter: true,
  logoDataUrl: null,
}

const QR_PX: Record<QRSize, number> = { sm: 300, md: 420, lg: 540 }

function fontStack(f: FontChoice, size: number, bold = false, italic = false) {
  const w = bold ? 'bold ' : ''
  const i = italic ? 'italic ' : ''
  if (f === 'playfair') return `${w}${i}${size}px 'Playfair Display', Georgia, serif`
  if (f === 'hand') return `${w}${i}${size}px 'Playwrite GB J', cursive`
  return `${w}${i}${size}px 'Geist', system-ui, -apple-system, sans-serif`
}

async function ensureFonts(font: FontChoice) {
  if (typeof document === 'undefined' || !document.fonts) return
  const names: Record<FontChoice, string> = {
    playfair: "'Playfair Display'",
    hand: "'Playwrite GB J'",
    sans: "'Geist'",
  }
  const n = names[font]
  try { await Promise.all([document.fonts.load(`bold 72px ${n}`), document.fonts.load(`400 72px ${n}`)]) }
  catch { /* ignore */ }
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

function drawBorderStyle(ctx: CanvasRenderingContext2D, style: BorderStyle, W: number, H: number, color: string, s: number) {
  if (style === 'none') return
  ctx.strokeStyle = color

  if (style === 'thin') {
    const p = Math.round(22 * s)
    ctx.lineWidth = Math.round(2 * s)
    ctx.strokeRect(p, p, W - p * 2, H - p * 2)
    return
  }

  if (style === 'double') {
    const p1 = Math.round(22 * s)
    ctx.lineWidth = Math.round(3 * s)
    ctx.strokeRect(p1, p1, W - p1 * 2, H - p1 * 2)
    const p2 = p1 + Math.round(11 * s)
    ctx.lineWidth = Math.round(1 * s)
    ctx.strokeRect(p2, p2, W - p2 * 2, H - p2 * 2)
    // corner brackets
    const arm = Math.round(44 * s)
    ctx.lineWidth = Math.round(2 * s)
    ctx.beginPath()
    ctx.moveTo(p2, p2 + arm); ctx.lineTo(p2, p2); ctx.lineTo(p2 + arm, p2)
    ctx.moveTo(W - p2 - arm, p2); ctx.lineTo(W - p2, p2); ctx.lineTo(W - p2, p2 + arm)
    ctx.moveTo(W - p2, H - p2 - arm); ctx.lineTo(W - p2, H - p2); ctx.lineTo(W - p2 - arm, H - p2)
    ctx.moveTo(p2 + arm, H - p2); ctx.lineTo(p2, H - p2); ctx.lineTo(p2, H - p2 - arm)
    ctx.stroke()
  }
}

export async function renderCustomCard(canvas: HTMLCanvasElement, cfg: Config, shareUrl: string, W: number) {
  const H = Math.round(W * (1700 / 1200))
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const s = W / 1200

  await ensureFonts(cfg.font)

  ctx.fillStyle = cfg.bgColor
  ctx.fillRect(0, 0, W, H)

  drawBorderStyle(ctx, cfg.border, W, H, cfg.textColor, s)

  const insetPad = cfg.border === 'none' ? 0 : Math.round(50 * s)
  let y = insetPad + Math.round(80 * s)
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'

  // Logo
  if (cfg.logoDataUrl) {
    try {
      const logo = await loadImg(cfg.logoDataUrl)
      const maxH = Math.round(140 * s), maxW = W - insetPad * 2 - Math.round(80 * s)
      const sc = Math.min(maxH / logo.naturalHeight, maxW / logo.naturalWidth)
      const lw = logo.naturalWidth * sc, lh = logo.naturalHeight * sc
      ctx.drawImage(logo, (W - lw) / 2, y, lw, lh)
      y += Math.round(lh + 44 * s)
    } catch { /* skip */ }
  }

  const qrMaxPx = QR_PX[cfg.qrSize]
  const footerH = cfg.showFooter ? Math.round(100 * s) : Math.round(40 * s)

  if (cfg.qrPos === 'bottom') {
    // Heading
    const hsz = Math.round(80 * s)
    ctx.font = fontStack(cfg.font, hsz, true)
    ctx.fillStyle = cfg.textColor
    const maxW = W - insetPad * 2 - Math.round(60 * s)
    for (const l of wrap(ctx, cfg.heading || 'Capture the Moment', maxW * 0.9)) {
      ctx.fillText(l, W / 2, y); y += Math.round(hsz * 1.24)
    }
    y += Math.round(26 * s)

    // Accent line
    ctx.strokeStyle = cfg.accentColor; ctx.lineWidth = Math.round(3 * s)
    const rw = Math.round(240 * s)
    ctx.beginPath(); ctx.moveTo((W - rw) / 2, y); ctx.lineTo((W + rw) / 2, y); ctx.stroke()
    y += Math.round(38 * s)

    // Body
    const bsz = Math.round(40 * s)
    ctx.font = fontStack(cfg.font, bsz)
    ctx.fillStyle = cfg.bodyColor
    for (const l of wrap(ctx, cfg.body, maxW * 0.78)) { ctx.fillText(l, W / 2, y); y += Math.round(bsz * 1.68) }
    y += Math.round(46 * s)

    // QR
    const qrSz = Math.min(Math.round(qrMaxPx * s), H - y - footerH - insetPad)
    if (qrSz > 30) {
      const du = await QRCode.toDataURL(shareUrl, { width: qrSz, margin: 1, color: { dark: cfg.qrColor, light: cfg.bgColor } })
      ctx.drawImage(await loadImg(du), (W - qrSz) / 2, y, qrSz, qrSz)
    }
  } else {
    // Heading (smaller to leave room for QR)
    const hsz = Math.round(68 * s)
    ctx.font = fontStack(cfg.font, hsz, true)
    ctx.fillStyle = cfg.textColor
    const maxW = W - insetPad * 2 - Math.round(60 * s)
    for (const l of wrap(ctx, cfg.heading || 'Capture the Moment', maxW * 0.9)) {
      ctx.fillText(l, W / 2, y); y += Math.round(hsz * 1.24)
    }
    y += Math.round(22 * s)

    ctx.strokeStyle = cfg.accentColor; ctx.lineWidth = Math.round(3 * s)
    const rw = Math.round(240 * s)
    ctx.beginPath(); ctx.moveTo((W - rw) / 2, y); ctx.lineTo((W + rw) / 2, y); ctx.stroke()
    y += Math.round(34 * s)

    // Large QR in center
    const bodyReserve = Math.round(240 * s)
    const qrSz = Math.min(Math.round(qrMaxPx * s), H - y - bodyReserve - footerH - insetPad)
    if (qrSz > 30) {
      const du = await QRCode.toDataURL(shareUrl, { width: qrSz, margin: 1, color: { dark: cfg.qrColor, light: cfg.bgColor } })
      ctx.drawImage(await loadImg(du), (W - qrSz) / 2, y, qrSz, qrSz)
      y += Math.round(qrSz + 40 * s)
    }

    // Body below QR
    const bsz = Math.round(40 * s)
    ctx.font = fontStack(cfg.font, bsz)
    ctx.fillStyle = cfg.bodyColor
    for (const l of wrap(ctx, cfg.body, maxW * 0.78)) { ctx.fillText(l, W / 2, y); y += Math.round(bsz * 1.68) }
  }

  if (cfg.showFooter) {
    ctx.font = fontStack(cfg.font, Math.round(30 * s))
    ctx.fillStyle = cfg.bodyColor + '80'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText('hushare.space', W / 2, H - insetPad - Math.round(40 * s))
  }
}

// ─── Color picker with hex input ────────────────────────────────────────────

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [hex, setHex] = useState(value)
  useEffect(() => { setHex(value) }, [value])

  function handleHex(raw: string) {
    const v = raw.startsWith('#') ? raw : '#' + raw
    setHex(v)
    if (/^#[0-9A-Fa-f]{6}$/.test(v)) onChange(v)
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs shrink-0" style={{ color: '#555' }}>{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={hex}
          onChange={(e) => handleHex(e.target.value)}
          maxLength={7}
          className="rounded border px-1.5 py-1 text-xs font-mono"
          style={{ width: 72, background: '#FAFAFA', borderColor: '#E0E0E0', color: '#1A1A1A' }}
        />
        <input
          type="color"
          value={value}
          onChange={(e) => { setHex(e.target.value); onChange(e.target.value) }}
          className="cursor-pointer rounded"
          style={{ width: 32, height: 28, border: '1px solid #E0E0E0', padding: 2, background: 'none' }}
        />
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold mb-1.5" style={{ color: '#555' }}>{children}</p>
}

function ChipGroup<T extends string>({
  options, value, onChange,
}: { options: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className="text-xs font-semibold rounded-lg px-3 py-1.5 transition"
          style={{
            background: value === o.value ? '#254F22' : '#F5F0E8',
            color: value === o.value ? '#FDFAF5' : '#5C3D2E',
            border: '1px solid ' + (value === o.value ? '#254F22' : '#DDD5C5'),
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

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
          className="text-sm font-medium"
          style={{ color: '#555' }}
        >
          ← Close
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
          className="rounded-2xl p-5 space-y-5 lg:w-80 shrink-0 overflow-y-auto"
          style={{ background: '#FFFFFF', border: '1px solid #E5E5E5', maxHeight: 'calc(100vh - 80px)' }}
        >
          {/* Text */}
          <div className="space-y-3">
            <Label>Heading</Label>
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ background: '#FAFAFA', borderColor: '#E0E0E0', color: '#1A1A1A' }}
              value={cfg.heading}
              onChange={(e) => set('heading', e.target.value)}
              maxLength={70}
              placeholder="Capture the Moment"
            />
            <Label>Description</Label>
            <textarea
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ background: '#FAFAFA', borderColor: '#E0E0E0', color: '#1A1A1A', resize: 'vertical', minHeight: 72 }}
              value={cfg.body}
              onChange={(e) => set('body', e.target.value)}
              maxLength={220}
            />
          </div>

          <hr style={{ borderColor: '#F0F0F0' }} />

          {/* Font */}
          <div>
            <Label>Font</Label>
            <ChipGroup
              value={cfg.font}
              onChange={(v) => set('font', v)}
              options={[
                { value: 'playfair', label: 'Serif' },
                { value: 'sans', label: 'Sans' },
                { value: 'hand', label: 'Script' },
              ]}
            />
          </div>

          {/* Colors */}
          <div className="space-y-2.5">
            <Label>Colors</Label>
            <ColorPicker label="Background" value={cfg.bgColor} onChange={(v) => set('bgColor', v)} />
            <ColorPicker label="Heading" value={cfg.textColor} onChange={(v) => set('textColor', v)} />
            <ColorPicker label="Body text" value={cfg.bodyColor} onChange={(v) => set('bodyColor', v)} />
            <ColorPicker label="Accent line" value={cfg.accentColor} onChange={(v) => set('accentColor', v)} />
            <ColorPicker label="QR code" value={cfg.qrColor} onChange={(v) => set('qrColor', v)} />
          </div>

          <hr style={{ borderColor: '#F0F0F0' }} />

          {/* QR options */}
          <div className="space-y-3">
            <div>
              <Label>QR position</Label>
              <ChipGroup
                value={cfg.qrPos}
                onChange={(v) => set('qrPos', v)}
                options={[
                  { value: 'bottom', label: 'QR bottom' },
                  { value: 'center', label: 'QR center' },
                ]}
              />
            </div>
            <div>
              <Label>QR size</Label>
              <ChipGroup
                value={cfg.qrSize}
                onChange={(v) => set('qrSize', v)}
                options={[
                  { value: 'sm', label: 'Small' },
                  { value: 'md', label: 'Medium' },
                  { value: 'lg', label: 'Large' },
                ]}
              />
            </div>
          </div>

          <hr style={{ borderColor: '#F0F0F0' }} />

          {/* Border */}
          <div>
            <Label>Border</Label>
            <ChipGroup
              value={cfg.border}
              onChange={(v) => set('border', v)}
              options={[
                { value: 'none', label: 'None' },
                { value: 'thin', label: 'Thin' },
                { value: 'double', label: 'Double' },
              ]}
            />
          </div>

          <hr style={{ borderColor: '#F0F0F0' }} />

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
            <span className="text-xs" style={{ color: '#555' }}>Show &quot;hushare.space&quot; footer</span>
          </label>
        </div>

        {/* Canvas preview */}
        <div className="flex-1 flex flex-col items-center gap-3 pt-2">
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

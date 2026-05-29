'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Copy, Download, QrCode, Share2, SquareMenu, X } from 'lucide-react'
import { renderBrandedCard, renderBWCard } from './TableCardModal'

type CardStyle = 'branded' | 'bw'

type Props = {
  copied: 'share' | 'owner' | null
  ownerUrl: string
  qrUrl: string
  shareUrl: string
  albumTitle: string
  onClose: () => void
  onCopy: (type: 'share' | 'owner') => void
}

async function downloadQr(shareUrl: string, albumTitle: string) {
  const QRCode = (await import('qrcode')).default
  const canvas = document.createElement('canvas')
  await QRCode.toCanvas(canvas, shareUrl, { width: 600, margin: 2, color: { dark: '#254F22', light: '#FFFFFF' } })
  const link = document.createElement('a')
  link.download = `${(albumTitle || 'album').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-qr.png`
  link.href = canvas.toDataURL('image/png')
  link.click()
}

// ─── Inline table card selector (no modal overlay) ────────────────────────────

function TableCardView({ shareUrl, albumTitle, onBack }: { shareUrl: string; albumTitle: string; onBack: () => void }) {
  const router = useRouter()
  const [style, setStyle] = useState<CardStyle>('branded')
  const [downloading, setDownloading] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const heading = albumTitle || 'Capture the Moment'

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    ;(style === 'branded' ? renderBrandedCard : renderBWCard)(c, heading, shareUrl, 240)
  }, [style, heading, shareUrl])

  async function handleDownload() {
    setDownloading(true)
    try {
      const off = document.createElement('canvas')
      await (style === 'branded' ? renderBrandedCard : renderBWCard)(off, heading, shareUrl, 1200)
      const link = document.createElement('a')
      link.download = `${(albumTitle || 'album').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-table-card.png`
      link.href = off.toDataURL('image/png')
      link.click()
    } finally { setDownloading(false) }
  }

  function openEditor() {
    const p = new URLSearchParams({ url: shareUrl, title: albumTitle || '' })
    router.push(`/card-editor?${p}`)
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <button onClick={onBack} className="flex items-center gap-1 text-xs font-medium rounded-lg px-2 py-1 transition hover:opacity-70"
          style={{ color: '#7C5C3E', background: '#F5F0E8', border: '1px solid #DDD5C5' }}>
          <ArrowLeft className="w-3 h-3" /> Back
        </button>
        <span className="text-sm font-semibold" style={{ color: '#254F22' }}>Table card</span>
      </div>

      {/* Style selector */}
      <div className="flex gap-1.5 mb-3">
        {(['branded', 'bw'] as CardStyle[]).map(s => (
          <button key={s} onClick={() => setStyle(s)}
            className="flex-1 py-2 text-xs font-semibold rounded-xl transition"
            style={{ background: style === s ? '#254F22' : '#F5F0E8', color: style === s ? '#FDFAF5' : '#5C3D2E', border: '1px solid ' + (style === s ? '#254F22' : '#DDD5C5') }}>
            {s === 'branded' ? 'Hushare Branded' : 'B&W'}
          </button>
        ))}
        <button onClick={openEditor}
          className="flex-1 py-2 text-xs font-semibold rounded-xl transition hover:opacity-80"
          style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}>
          Custom
        </button>
      </div>

      {/* Preview + download side by side */}
      <div className="flex gap-3 items-start">
        <canvas ref={canvasRef}
          style={{ width: 130, height: Math.round(130 * 1700 / 1200), flexShrink: 0, borderRadius: 8, border: '1px solid #E5E5E5', boxShadow: '0 2px 10px rgba(0,0,0,0.08)' }} />
        <div className="flex-1 space-y-2 pt-1">
          <p className="text-xs leading-relaxed" style={{ color: '#7C5C3E' }}>
            {style === 'branded' ? 'Hushare red & white, Playfair Display.' : 'Elegant B&W, double border.'}
            {' '}Print-ready 1200×1700 px.
          </p>
          <button onClick={handleDownload} disabled={downloading}
            className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold rounded-xl py-2.5 transition hover:opacity-90 disabled:opacity-50"
            style={{ background: '#254F22', color: '#FDFAF5' }}>
            <Download className="w-3.5 h-3.5" />
            {downloading ? 'Generating…' : 'Download PNG'}
          </button>
          <p className="text-xs" style={{ color: '#A89880' }}>A5 / 5×7&quot;</p>
        </div>
      </div>
    </div>
  )
}

// ─── Main share menu ──────────────────────────────────────────────────────────

export default function ShareMenu({ copied, ownerUrl, qrUrl, shareUrl, albumTitle, onClose, onCopy }: Props) {
  const [view, setView] = useState<'main' | 'tablecard'>('main')

  async function handleShare() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ url: shareUrl, title: albumTitle, text: `Check out "${albumTitle}" on Hushare` }); return } catch { /* fall through */ }
    }
    try { await navigator.clipboard.writeText(shareUrl); onCopy('share') } catch { /* ignore */ }
  }

  return (
    <div
      className="hush-menu-pop absolute left-0 top-full mt-2 z-50 rounded-2xl shadow-xl"
      style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', width: 320, padding: 16, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto' }}
    >
      {view === 'tablecard' ? (
        <TableCardView shareUrl={shareUrl} albumTitle={albumTitle} onBack={() => setView('main')} />
      ) : (
        <>
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold text-sm" style={{ color: '#254F22' }}>Send link</span>
            <button onClick={onClose} style={{ color: '#A89880', cursor: 'pointer' }} aria-label="Close share menu">
              <X className="w-4 h-4" />
            </button>
          </div>

          <button
            className="hush-hover-lift w-full flex items-center justify-between gap-3 rounded-xl px-3 py-3 mb-2 text-left transition hover:opacity-90"
            style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', cursor: 'pointer' }}
            onClick={handleShare}
          >
            <span>
              <span className="block text-sm font-semibold" style={{ color: '#254F22' }}>Share album</span>
              <span className="block text-xs" style={{ color: '#8B6F4E' }}>Send via messages, apps or copy</span>
            </span>
            <Share2 className="w-4 h-4 flex-none" style={{ color: '#7C5C3E' }} />
          </button>

          <button
            className="hush-hover-lift w-full flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition hover:opacity-90"
            style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', cursor: 'pointer' }}
            onClick={() => onCopy('share')}
          >
            <span>
              <span className="block text-sm font-semibold" style={{ color: '#254F22' }}>Guest share link</span>
              <span className="block text-xs truncate" style={{ color: '#8B6F4E', maxWidth: 220 }}>{shareUrl}</span>
            </span>
            {copied === 'share' ? <Check className="w-4 h-4" style={{ color: '#254F22' }} /> : <Copy className="w-4 h-4" style={{ color: '#7C5C3E' }} />}
          </button>

          <button
            className="hush-hover-lift w-full flex items-center justify-between gap-3 rounded-xl px-3 py-3 mt-2 text-left transition hover:opacity-90"
            style={{ background: '#E8F0FB', border: '1px solid #B8CCEE', cursor: 'pointer' }}
            onClick={() => onCopy('owner')}
          >
            <span>
              <span className="block text-sm font-semibold" style={{ color: '#1B3A6B' }}>Owner management link</span>
              <span className="block text-xs truncate" style={{ color: '#45628C', maxWidth: 220 }}>{ownerUrl}</span>
            </span>
            {copied === 'owner' ? <Check className="w-4 h-4" style={{ color: '#1B3A6B' }} /> : <Copy className="w-4 h-4" style={{ color: '#1B3A6B' }} />}
          </button>

          <div className="mt-3 rounded-xl p-3" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
            <div className="flex items-center gap-3">
              <Image src={qrUrl} alt="QR Code" width={92} height={92} unoptimized />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold flex items-center gap-2" style={{ color: '#254F22' }}>
                  <QrCode className="w-4 h-4" />
                  QR code
                </p>
                <p className="text-xs leading-relaxed" style={{ color: '#7C5C3E' }}>Guests scan this to open the album.</p>
                <div className="mt-2 flex gap-2 flex-wrap">
                  <button
                    className="flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2.5 py-1.5 transition hover:opacity-80"
                    style={{ background: '#254F22', color: '#FDFAF5' }}
                    onClick={() => downloadQr(shareUrl, albumTitle)}
                  >
                    <Download className="w-3 h-3" />
                    Download PNG
                  </button>
                  <button
                    className="flex items-center gap-1.5 text-xs font-semibold rounded-lg px-2.5 py-1.5 transition hover:opacity-80"
                    style={{ background: '#F5F0E8', color: '#5C3D2E', border: '1px solid #DDD5C5' }}
                    onClick={() => setView('tablecard')}
                  >
                    <SquareMenu className="w-3 h-3" />
                    Table card
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

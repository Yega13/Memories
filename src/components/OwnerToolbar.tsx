'use client'

import { useState, useRef, useEffect } from 'react'
import { type Album, type Photo } from '@/lib/supabase'
import { Copy, QrCode, Download, Check, Settings, X } from 'lucide-react'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'

type Props = {
  album: Album
  photos: Photo[]
  ownerToken: string
  bgColor: string
  onBgColorChange: (color: string) => void
}

const PRESETS = [
  { label: 'Cream', value: '#FDFAF5' },
  { label: 'White', value: '#FFFFFF' },
  { label: 'Sky', value: '#EDF4FB' },
  { label: 'Sage', value: '#EFF4EE' },
  { label: 'Blush', value: '#FDF0F2' },
  { label: 'Lavender', value: '#F2EFF8' },
  { label: 'Midnight', value: '#1C2333' },
  { label: 'Forest', value: '#1A2B1A' },
]

export default function OwnerToolbar({ album, photos, ownerToken, bgColor, onBgColorChange }: Props) {
  const [copied, setCopied] = useState<'share' | 'owner' | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)

  const shareUrl = `${window.location.origin}/${album.slug}`
  const ownerUrl = `${window.location.origin}/${album.slug}?owner=${ownerToken}`

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false)
      }
    }
    if (showSettings) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showSettings])

  async function copy(type: 'share' | 'owner') {
    await navigator.clipboard.writeText(type === 'share' ? shareUrl : ownerUrl)
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
  }

  async function downloadZip() {
    if (photos.length === 0) return
    setZipping(true)
    const zip = new JSZip()
    const folder = zip.folder(album.title) || zip

    await Promise.all(
      photos.map(async (photo, i) => {
        const res = await fetch(photo.url)
        const blob = await res.blob()
        const ext = photo.url.split('.').pop()?.split('?')[0] || 'jpg'
        const name = photo.caption
          ? `${i + 1}-${photo.caption.replace(/[^a-z0-9]/gi, '_')}.${ext}`
          : `photo-${i + 1}.${ext}`
        folder.file(name, blob)
      })
    )

    const content = await zip.generateAsync({ type: 'blob' })
    saveAs(content, `${album.title}.zip`)
    setZipping(false)
  }

  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(shareUrl)}`

  const btnBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    fontWeight: 500,
    padding: '6px 14px',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'opacity 0.15s',
    background: '#FFFFFF',
    border: '1px solid #DDD5C5',
    color: '#254F22',
  }

  const isDark = bgColor === '#1C2333' || bgColor === '#1A2B1A'

  return (
    <div style={{ background: '#F5F0E8', borderBottom: '1px solid #DDD5C5' }}>
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
        <button style={btnBase} onClick={() => copy('share')}>
          {copied === 'share' ? <Check className="w-4 h-4" style={{ color: '#254F22' }} /> : <Copy className="w-4 h-4" style={{ color: '#7C5C3E' }} />}
          {copied === 'share' ? 'Copied!' : 'Copy share link'}
        </button>

        <button style={{ ...btnBase, background: '#E8F0FB', border: '1px solid #B8CCEE', color: '#1B3A6B' }} onClick={() => copy('owner')}>
          {copied === 'owner' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied === 'owner' ? 'Copied!' : 'Copy owner link'}
        </button>

        <button style={btnBase} onClick={() => setShowQr(!showQr)}>
          <QrCode className="w-4 h-4" style={{ color: '#7C5C3E' }} />
          QR Code
        </button>

        <button style={{ ...btnBase, opacity: zipping || photos.length === 0 ? 0.5 : 1 }} onClick={downloadZip} disabled={zipping || photos.length === 0}>
          <Download className="w-4 h-4" style={{ color: '#7C5C3E' }} />
          {zipping ? 'Zipping...' : `Download all (${photos.length})`}
        </button>

        <div className="relative ml-auto" ref={settingsRef}>
          <button
            style={{ ...btnBase, padding: '6px 10px' }}
            onClick={() => setShowSettings(s => !s)}
            title="Settings"
          >
            <Settings className="w-4 h-4" style={{ color: '#7C5C3E' }} />
            Settings
          </button>

          {showSettings && (
            <div
              className="absolute right-0 top-full mt-2 z-50 rounded-2xl shadow-xl"
              style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', width: 260, padding: '16px' }}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-sm" style={{ color: '#254F22' }}>Background color</span>
                <button onClick={() => setShowSettings(false)} style={{ color: '#A89880', cursor: 'pointer' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-4 gap-2 mb-3">
                {PRESETS.map(preset => (
                  <button
                    key={preset.value}
                    title={preset.label}
                    onClick={() => onBgColorChange(preset.value)}
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      borderRadius: '10px',
                      background: preset.value,
                      border: bgColor === preset.value ? '2px solid #254F22' : '1.5px solid #DDD5C5',
                      cursor: 'pointer',
                      position: 'relative',
                    }}
                  >
                    {bgColor === preset.value && (
                      <span style={{
                        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, color: isDark ? '#fff' : '#254F22',
                      }}>✓</span>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <label className="text-xs font-medium" style={{ color: '#7C5C3E' }}>Custom</label>
                <input
                  type="color"
                  value={bgColor}
                  onChange={e => onBgColorChange(e.target.value)}
                  style={{ width: 36, height: 28, borderRadius: 8, border: '1.5px solid #DDD5C5', cursor: 'pointer', padding: 2 }}
                />
                <span className="text-xs font-mono" style={{ color: '#A89880' }}>{bgColor}</span>
              </div>

              <button
                className="mt-3 w-full text-xs"
                style={{ color: '#A89880', cursor: 'pointer', textAlign: 'center' }}
                onClick={() => onBgColorChange('#FDFAF5')}
              >
                Reset to default
              </button>
            </div>
          )}
        </div>
      </div>

      {showQr && (
        <div className="max-w-6xl mx-auto px-4 pb-4">
          <div className="inline-block p-3 rounded-xl" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
            <img src={qrUrl} alt="QR Code" width={150} height={150} />
          </div>
          <p className="text-xs mt-2" style={{ color: '#7C5C3E' }}>Scan to open the album</p>
        </div>
      )}
    </div>
  )
}

'use client'

import Image from 'next/image'
import { Check, Copy, QrCode, Share2, X } from 'lucide-react'

type Props = {
  copied: 'share' | 'owner' | null
  ownerUrl: string
  qrUrl: string
  shareUrl: string
  albumTitle: string
  onClose: () => void
  onCopy: (type: 'share' | 'owner') => void
}

export default function ShareMenu({ copied, ownerUrl, qrUrl, shareUrl, albumTitle, onClose, onCopy }: Props) {
  const canNativeShare = typeof navigator !== 'undefined' && !!navigator.share

  async function nativeShare() {
    try {
      await navigator.share({ url: shareUrl, title: albumTitle })
    } catch {
      // user cancelled or share failed — silently ignore
    }
  }

  return (
    <div
      className="hush-menu-pop absolute left-0 top-full mt-2 z-50 rounded-2xl shadow-xl"
      style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', width: 320, padding: 16 }}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="font-semibold text-sm" style={{ color: '#254F22' }}>Send link</span>
        <button onClick={onClose} style={{ color: '#A89880', cursor: 'pointer' }} aria-label="Close share menu">
          <X className="w-4 h-4" />
        </button>
      </div>

      {canNativeShare && (
        <button
          className="hush-hover-lift w-full flex items-center justify-between gap-3 rounded-xl px-3 py-3 mb-2 text-left transition hover:opacity-90"
          style={{ background: '#254F22', cursor: 'pointer' }}
          onClick={nativeShare}
        >
          <span className="text-sm font-semibold" style={{ color: '#FDFAF5' }}>Share album</span>
          <Share2 className="w-4 h-4 flex-none" style={{ color: '#FDFAF5' }} />
        </button>
      )}

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
          <div>
            <p className="text-sm font-semibold flex items-center gap-2" style={{ color: '#254F22' }}>
              <QrCode className="w-4 h-4" />
              QR code
            </p>
            <p className="text-xs leading-relaxed" style={{ color: '#7C5C3E' }}>Guests scan this to open the album.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

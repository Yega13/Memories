'use client'

import { useState, useRef, useEffect } from 'react'
import { type Album, type Photo } from '@/lib/supabase'
import type { Tier } from '@/lib/subscriptions'
import Image from 'next/image'
import { Copy, QrCode, Download, Check, Settings, X, Link2, Lock, LockOpen } from 'lucide-react'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'

type Props = {
  album: Album
  photos: Photo[]
  ownerToken: string
  userTier: Tier
  bgChoice: string
  onBgChoiceChange: (choice: string) => void
  onAlbumUpdated: (patch: Partial<Album>) => void
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

const STOCK_BACKGROUNDS = [
  { label: 'Wedding', value: 'image:/wedding.jpg', src: '/wedding.jpg' },
  { label: 'Trail', value: 'image:/card1.jpg', src: '/card1.jpg' },
  { label: 'Golden', value: 'image:/card2.jpg', src: '/card2.jpg' },
  { label: 'Lake', value: 'image:/card3.jpg', src: '/card3.jpg' },
  { label: 'Explorers', value: 'image:/children.avif', src: '/children.avif' },
]

const DEFAULT_BG = '#FDFAF5'

export default function OwnerToolbar({ album, photos, ownerToken, userTier, bgChoice, onBgChoiceChange, onAlbumUpdated }: Props) {
  const [copied, setCopied] = useState<'share' | 'owner' | null>(null)
  const [showQr, setShowQr] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showCustomUrl, setShowCustomUrl] = useState(false)
  const [customUrlInput, setCustomUrlInput] = useState(album.custom_slug ?? '')
  const [customUrlSaving, setCustomUrlSaving] = useState(false)
  const [customUrlError, setCustomUrlError] = useState('')
  const [customUrlSaved, setCustomUrlSaved] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSaved, setPasswordSaved] = useState(false)
  const settingsRef = useRef<HTMLDivElement>(null)
  const customUrlRef = useRef<HTMLDivElement>(null)
  const passwordRef = useRef<HTMLDivElement>(null)

  // Prefer the custom slug for the share link if one is set — that's the
  // whole point of paying for it. The owner link always uses the random
  // slug so the owner_token + slug pair stays stable across renames.
  const publicSlug = album.custom_slug ?? album.slug
  const shareUrl = `${window.location.origin}/${publicSlug}`
  const ownerUrl = `${window.location.origin}/${album.slug}?owner=${ownerToken}`
  const canCustomize = userTier === 'pro' || userTier === 'studio'

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setShowSettings(false)
      }
    }
    if (showSettings) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showSettings])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (customUrlRef.current && !customUrlRef.current.contains(e.target as Node)) {
        setShowCustomUrl(false)
        setCustomUrlError('')
        setCustomUrlSaved(false)
      }
    }
    if (showCustomUrl) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showCustomUrl])

  // Keep the input in sync if the album's custom_slug changes externally
  // (e.g. another owner-link tab clears it). Only resets when popover closed.
  useEffect(() => {
    if (!showCustomUrl) setCustomUrlInput(album.custom_slug ?? '')
  }, [album.custom_slug, showCustomUrl])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (passwordRef.current && !passwordRef.current.contains(e.target as Node)) {
        setShowPassword(false)
        setPasswordError('')
        setPasswordSaved(false)
        setPasswordInput('')
      }
    }
    if (showPassword) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showPassword])

  async function savePassword(action: 'set' | 'clear') {
    setPasswordSaving(true)
    setPasswordError('')
    setPasswordSaved(false)
    try {
      const res = await fetch('/api/album/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: album.slug,
          owner_token: ownerToken,
          password: action === 'clear' ? null : passwordInput,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; password_protected?: boolean }
      if (!res.ok) {
        setPasswordError(body.error ?? `Save failed (${res.status})`)
        return
      }
      onAlbumUpdated({ password_protected: !!body.password_protected })
      setPasswordSaved(true)
      setPasswordInput('')
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setPasswordSaving(false)
    }
  }

  async function saveCustomUrl(action: 'set' | 'clear') {
    setCustomUrlSaving(true)
    setCustomUrlError('')
    setCustomUrlSaved(false)
    try {
      const res = await fetch('/api/album/custom-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: album.slug,
          owner_token: ownerToken,
          custom_slug: action === 'clear' ? null : customUrlInput.trim().toLowerCase(),
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; custom_slug?: string | null }
      if (!res.ok) {
        setCustomUrlError(body.error ?? `Save failed (${res.status})`)
        return
      }
      onAlbumUpdated({ custom_slug: body.custom_slug ?? null })
      setCustomUrlSaved(true)
      if (action === 'clear') setCustomUrlInput('')
    } catch (e) {
      setCustomUrlError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setCustomUrlSaving(false)
    }
  }

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
        const pathExt = photo.storage_path.split('.').pop()?.toLowerCase()
        const urlExt = photo.url.split('.').pop()?.split('?')[0]?.toLowerCase()
        const ext = pathExt || urlExt || (photo.media_type === 'video' ? 'mp4' : 'jpg')
        const prefix = photo.media_type === 'video' ? 'video' : 'photo'
        const name = photo.caption
          ? `${i + 1}-${photo.caption.replace(/[^a-z0-9]/gi, '_')}.${ext}`
          : `${prefix}-${i + 1}.${ext}`
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

  const currentColor = bgChoice.startsWith('#') ? bgChoice : DEFAULT_BG
  const isDark = bgChoice === '#1C2333' || bgChoice === '#1A2B1A' || bgChoice.startsWith('image:')

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

        <div className="relative ml-auto" ref={customUrlRef}>
          <button
            style={{
              ...btnBase,
              background: canCustomize ? '#FFFFFF' : '#F5F0E8',
              color: canCustomize ? '#254F22' : '#A89880',
              cursor: canCustomize ? 'pointer' : 'not-allowed',
            }}
            onClick={() => canCustomize && setShowCustomUrl((s) => !s)}
            title={canCustomize ? 'Set a custom URL for this album' : 'Available on Pro and Studio plans'}
            disabled={!canCustomize}
          >
            <Link2 className="w-4 h-4" style={{ color: canCustomize ? '#7C5C3E' : '#A89880' }} />
            {album.custom_slug ? `/${album.custom_slug}` : 'Custom URL'}
            {!canCustomize && (
              <span className="ml-1 text-[10px] font-semibold uppercase" style={{ color: '#7C4A2D', letterSpacing: '0.06em' }}>
                Pro
              </span>
            )}
          </button>

          {showCustomUrl && canCustomize && (
            <div
              className="absolute right-0 top-full mt-2 z-50 rounded-2xl shadow-xl"
              style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', width: 320, padding: '16px' }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm" style={{ color: '#254F22' }}>Custom URL</span>
                <button onClick={() => setShowCustomUrl(false)} style={{ color: '#A89880', cursor: 'pointer' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs mb-3" style={{ color: '#7C5C3E' }}>
                Pick a friendly path for this album. Letters, numbers, and hyphens — 3 to 40 characters.
              </p>
              <div className="flex items-stretch rounded-lg overflow-hidden" style={{ border: '1px solid #DDD5C5', background: '#FDFAF5' }}>
                <span className="text-xs flex items-center px-2 select-none" style={{ color: '#A89880' }}>
                  hushare.space/
                </span>
                <input
                  type="text"
                  value={customUrlInput}
                  onChange={(e) => setCustomUrlInput(e.target.value)}
                  placeholder="anna-and-david"
                  maxLength={40}
                  className="flex-1 text-sm px-2 py-2 focus:outline-none"
                  style={{ background: 'transparent', color: '#254F22' }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !customUrlSaving && customUrlInput.trim()) saveCustomUrl('set')
                  }}
                />
              </div>

              {customUrlError && (
                <p className="text-xs mt-2" style={{ color: '#C0392B' }}>{customUrlError}</p>
              )}
              {customUrlSaved && !customUrlError && (
                <p className="text-xs mt-2" style={{ color: '#254F22' }}>Saved.</p>
              )}

              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => saveCustomUrl('set')}
                  disabled={customUrlSaving || !customUrlInput.trim()}
                  className="flex-1 text-sm font-semibold rounded-lg py-2 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: '#254F22', color: '#FDFAF5' }}
                >
                  {customUrlSaving ? 'Saving…' : 'Save'}
                </button>
                {album.custom_slug && (
                  <button
                    onClick={() => saveCustomUrl('clear')}
                    disabled={customUrlSaving}
                    className="text-sm rounded-lg py-2 px-3 transition hover:opacity-90 disabled:opacity-50"
                    style={{ background: '#F5F0E8', color: '#7C5C3E', border: '1px solid #DDD5C5' }}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="relative" ref={passwordRef}>
          <button
            style={{
              ...btnBase,
              background: canCustomize ? '#FFFFFF' : '#F5F0E8',
              color: canCustomize ? '#254F22' : '#A89880',
              cursor: canCustomize ? 'pointer' : 'not-allowed',
            }}
            onClick={() => canCustomize && setShowPassword((s) => !s)}
            title={canCustomize ? 'Set a password for this album' : 'Available on Pro and Studio plans'}
            disabled={!canCustomize}
          >
            {album.password_protected ? (
              <Lock className="w-4 h-4" style={{ color: canCustomize ? '#254F22' : '#A89880' }} />
            ) : (
              <LockOpen className="w-4 h-4" style={{ color: canCustomize ? '#7C5C3E' : '#A89880' }} />
            )}
            {album.password_protected ? 'Password set' : 'Password'}
            {!canCustomize && (
              <span className="ml-1 text-[10px] font-semibold uppercase" style={{ color: '#7C4A2D', letterSpacing: '0.06em' }}>
                Pro
              </span>
            )}
          </button>

          {showPassword && canCustomize && (
            <div
              className="absolute right-0 top-full mt-2 z-50 rounded-2xl shadow-xl"
              style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', width: 320, padding: '16px' }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-sm" style={{ color: '#254F22' }}>Album password</span>
                <button onClick={() => setShowPassword(false)} style={{ color: '#A89880', cursor: 'pointer' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <p className="text-xs mb-3" style={{ color: '#7C5C3E' }}>
                Visitors will need this password to view the album. 4–128 characters. {album.password_protected && 'Saving a new value replaces the old password.'}
              </p>
              <input
                type="password"
                value={passwordInput}
                onChange={(e) => setPasswordInput(e.target.value)}
                placeholder={album.password_protected ? 'New password' : 'Password'}
                maxLength={128}
                className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !passwordSaving && passwordInput) savePassword('set')
                }}
              />

              {passwordError && (
                <p className="text-xs mt-2" style={{ color: '#C0392B' }}>{passwordError}</p>
              )}
              {passwordSaved && !passwordError && (
                <p className="text-xs mt-2" style={{ color: '#254F22' }}>Saved.</p>
              )}

              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={() => savePassword('set')}
                  disabled={passwordSaving || !passwordInput}
                  className="flex-1 text-sm font-semibold rounded-lg py-2 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ background: '#254F22', color: '#FDFAF5' }}
                >
                  {passwordSaving ? 'Saving…' : 'Save'}
                </button>
                {album.password_protected && (
                  <button
                    onClick={() => savePassword('clear')}
                    disabled={passwordSaving}
                    className="text-sm rounded-lg py-2 px-3 transition hover:opacity-90 disabled:opacity-50"
                    style={{ background: '#F5F0E8', color: '#7C5C3E', border: '1px solid #DDD5C5' }}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="relative" ref={settingsRef}>
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
                <span className="font-semibold text-sm" style={{ color: '#254F22' }}>Album background</span>
                <button onClick={() => setShowSettings(false)} style={{ color: '#A89880', cursor: 'pointer' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-[11px] font-semibold uppercase mb-2" style={{ color: '#8B6F4E', letterSpacing: '0.08em' }}>
                Colors
              </p>
              <div className="grid grid-cols-4 gap-2 mb-3">
                {PRESETS.map(preset => (
                  <button
                    key={preset.value}
                    title={preset.label}
                    onClick={() => onBgChoiceChange(preset.value)}
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      borderRadius: '10px',
                      background: preset.value,
                      border: bgChoice === preset.value ? '2px solid #254F22' : '1.5px solid #DDD5C5',
                      cursor: 'pointer',
                      position: 'relative',
                    }}
                  >
                    {bgChoice === preset.value && (
                      <span style={{
                        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 14, color: isDark ? '#fff' : '#254F22',
                      }}>✓</span>
                    )}
                  </button>
                ))}
              </div>

              <p className="text-[11px] font-semibold uppercase mb-2" style={{ color: '#8B6F4E', letterSpacing: '0.08em' }}>
                Stock photos
              </p>
              <div className="grid grid-cols-5 gap-2 mb-3">
                {STOCK_BACKGROUNDS.map((preset) => (
                  <button
                    key={preset.value}
                    title={preset.label}
                    onClick={() => onBgChoiceChange(preset.value)}
                    className="relative overflow-hidden"
                    style={{
                      width: '100%',
                      aspectRatio: '1',
                      borderRadius: '10px',
                      backgroundImage: `url(${preset.src})`,
                      backgroundPosition: 'center',
                      backgroundSize: 'cover',
                      border: bgChoice === preset.value ? '2px solid #254F22' : '1.5px solid #DDD5C5',
                      cursor: 'pointer',
                    }}
                  >
                    {bgChoice === preset.value && (
                      <span
                        style={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          background: 'rgba(37,79,34,0.25)',
                          fontSize: 14,
                        }}
                      >
                        ✓
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <label className="text-xs font-medium" style={{ color: '#7C5C3E' }}>Custom</label>
                <input
                  type="color"
                  value={currentColor}
                  onChange={e => onBgChoiceChange(e.target.value)}
                  style={{ width: 36, height: 28, borderRadius: 8, border: '1.5px solid #DDD5C5', cursor: 'pointer', padding: 2 }}
                />
                <span className="text-xs font-mono" style={{ color: '#A89880' }}>{currentColor}</span>
              </div>

              <button
                className="mt-3 w-full text-xs"
                style={{ color: '#A89880', cursor: 'pointer', textAlign: 'center' }}
                onClick={() => onBgChoiceChange('#FDFAF5')}
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
            <Image src={qrUrl} alt="QR Code" width={150} height={150} unoptimized />
          </div>
          <p className="text-xs mt-2" style={{ color: '#7C5C3E' }}>Scan to open the album</p>
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { Check, ChevronDown, Copy, Download, FolderPlus, Images, Link2, Lock, LockOpen, QrCode, Settings, X } from 'lucide-react'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import { type Album, type Photo } from '@/lib/supabase'
import { STOCK_ALBUM_BACKGROUNDS } from '@/lib/album-backgrounds'
import type { Tier } from '@/lib/subscriptions'

type Props = {
  album: Album
  photos: Photo[]
  ownerToken: string
  userTier: Tier
  onAlbumUpdated: (patch: Partial<Album>) => void
}

type SettingsSection = 'customization' | 'files' | 'customUrl' | 'password' | 'collection'

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

const FEATURED_STOCK_BACKGROUNDS = STOCK_ALBUM_BACKGROUNDS.slice(0, 5)
const DEFAULT_BG = '#FDFAF5'

export default function OwnerToolbar({ album, photos, ownerToken, userTier, onAlbumUpdated }: Props) {
  const [copied, setCopied] = useState<'share' | 'owner' | null>(null)
  const [showShare, setShowShare] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [openSection, setOpenSection] = useState<SettingsSection | null>(null)
  const [zipping, setZipping] = useState(false)
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number; failed: number } | null>(null)

  const [customUrlInput, setCustomUrlInput] = useState(album.custom_slug ?? '')
  const [customUrlSaving, setCustomUrlSaving] = useState(false)
  const [customUrlError, setCustomUrlError] = useState('')
  const [customUrlSaved, setCustomUrlSaved] = useState(false)

  const [passwordInput, setPasswordInput] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSaved, setPasswordSaved] = useState(false)

  const [collectionName, setCollectionName] = useState('')
  const [collectionSlug, setCollectionSlug] = useState('')
  const [collectionSaving, setCollectionSaving] = useState(false)
  const [collectionError, setCollectionError] = useState('')
  const [collectionUrl, setCollectionUrl] = useState('')

  const [backgroundSaving, setBackgroundSaving] = useState(false)
  const [backgroundError, setBackgroundError] = useState('')
  const [showBackgroundLibrary, setShowBackgroundLibrary] = useState(false)

  const shareRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)

  const publicSlug = album.custom_slug ?? album.slug
  const shareUrl = `${window.location.origin}/${publicSlug}`
  const ownerUrl = `${window.location.origin}/${album.slug}?owner=${ownerToken}`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(shareUrl)}`
  const canCustomize = userTier === 'pro' || userTier === 'studio'
  const canUseCollections = userTier === 'studio'
  const bgChoice = album.background_theme ?? DEFAULT_BG
  const currentColor = bgChoice.startsWith('#') ? bgChoice : DEFAULT_BG
  const isDark = bgChoice === '#1C2333' || bgChoice === '#1A2B1A' || bgChoice.startsWith('image:')

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node
      if (shareRef.current && !shareRef.current.contains(target)) setShowShare(false)
      if (settingsRef.current && !settingsRef.current.contains(target)) setShowSettings(false)
    }
    if (showShare || showSettings) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showShare, showSettings])

  useEffect(() => {
    if (!showSettings) {
      setCustomUrlInput(album.custom_slug ?? '')
      setCustomUrlError('')
      setCustomUrlSaved(false)
      setPasswordError('')
      setPasswordSaved(false)
      setPasswordInput('')
      setCollectionError('')
      setOpenSection(null)
    }
  }, [album.custom_slug, showSettings])

  function toggleSection(section: SettingsSection) {
    setOpenSection((current) => {
      const next = current === section ? null : section
      if (section === 'password') {
        setPasswordInput('')
        setPasswordError('')
        setPasswordSaved(false)
      }
      return next
    })
  }

  async function copy(type: 'share' | 'owner') {
    await navigator.clipboard.writeText(type === 'share' ? shareUrl : ownerUrl)
    setCopied(type)
    setTimeout(() => setCopied(null), 2000)
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

  async function saveBackground(choice: string | null): Promise<boolean> {
    setBackgroundSaving(true)
    setBackgroundError('')
    try {
      const res = await fetch('/api/album/background', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: album.slug,
          owner_token: ownerToken,
          background_theme: choice,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; background_theme?: string | null }
      if (!res.ok) {
        setBackgroundError(body.error ?? `Save failed (${res.status})`)
        return false
      }
      onAlbumUpdated({ background_theme: body.background_theme ?? null })
      return true
    } catch (e) {
      setBackgroundError(e instanceof Error ? e.message : 'Network error')
      return false
    } finally {
      setBackgroundSaving(false)
    }
  }

  async function chooseBackground(choice: string, closeLibrary = false) {
    const saved = await saveBackground(choice)
    if (saved && closeLibrary) setShowBackgroundLibrary(false)
  }

  async function createCollection() {
    setCollectionSaving(true)
    setCollectionError('')
    setCollectionUrl('')
    try {
      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: album.slug,
          owner_token: ownerToken,
          name: collectionName,
          collection_slug: collectionSlug,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        collection?: { slug: string }
      }
      if (!res.ok || !body.collection?.slug) {
        setCollectionError(body.error ?? `Save failed (${res.status})`)
        return
      }
      setCollectionUrl(`${window.location.origin}/c/${body.collection.slug}`)
    } catch (e) {
      setCollectionError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setCollectionSaving(false)
    }
  }

  async function downloadZip() {
    if (photos.length === 0) return
    setZipping(true)
    setZipProgress({ done: 0, total: photos.length, failed: 0 })
    const zip = new JSZip()
    const folder = zip.folder(album.title) || zip
    let failed = 0

    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i]
      try {
        const res = await fetch(photo.url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const blob = await res.blob()
        const pathExt = photo.storage_path.split('.').pop()?.toLowerCase()
        const urlExt = photo.url.split('.').pop()?.split('?')[0]?.toLowerCase()
        const ext = pathExt || urlExt || (photo.media_type === 'video' ? 'mp4' : 'jpg')
        const prefix = photo.media_type === 'video' ? 'video' : 'photo'
        const name = photo.caption
          ? `${i + 1}-${photo.caption.replace(/[^a-z0-9]/gi, '_')}.${ext}`
          : `${prefix}-${i + 1}.${ext}`
        folder.file(name, blob)
      } catch (e) {
        failed += 1
        console.warn('[downloadZip] failed to fetch item:', photo.id, e)
      }
      setZipProgress({ done: i + 1, total: photos.length, failed })
    }

    if (failed === photos.length) {
      setZipping(false)
      return
    }

    const content = await zip.generateAsync({ type: 'blob' })
    saveAs(content, `${album.title}.zip`)
    setZipping(false)
    setTimeout(() => setZipProgress(null), 2500)
  }

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

  const sectionTitle: React.CSSProperties = {
    color: '#8B6F4E',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
  }

  const inputStyle: React.CSSProperties = {
    background: '#FDFAF5',
    border: '1px solid #DDD5C5',
    color: '#254F22',
  }

  const accordionButton: React.CSSProperties = {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 0',
    cursor: 'pointer',
    color: '#254F22',
    background: 'transparent',
    border: 0,
    textAlign: 'left',
  }

  return (
    <div style={{ background: '#F5F0E8', borderBottom: '1px solid #DDD5C5' }}>
      <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="relative" ref={shareRef}>
          <button
            style={btnBase}
            onClick={() => {
              setShowShare((s) => !s)
              setShowSettings(false)
            }}
          >
            <Copy className="w-4 h-4" style={{ color: '#7C5C3E' }} />
            Share
          </button>

          {showShare && (
            <div
              className="absolute left-0 top-full mt-2 z-50 rounded-2xl shadow-xl"
              style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', width: 320, padding: 16 }}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-sm" style={{ color: '#254F22' }}>Send link</span>
                <button onClick={() => setShowShare(false)} style={{ color: '#A89880', cursor: 'pointer' }} aria-label="Close share menu">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <button
                className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition hover:opacity-90"
                style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', cursor: 'pointer' }}
                onClick={() => copy('share')}
              >
                <span>
                  <span className="block text-sm font-semibold" style={{ color: '#254F22' }}>Guest share link</span>
                  <span className="block text-xs truncate" style={{ color: '#8B6F4E', maxWidth: 220 }}>{shareUrl}</span>
                </span>
                {copied === 'share' ? <Check className="w-4 h-4" style={{ color: '#254F22' }} /> : <Copy className="w-4 h-4" style={{ color: '#7C5C3E' }} />}
              </button>

              <button
                className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-3 mt-2 text-left transition hover:opacity-90"
                style={{ background: '#E8F0FB', border: '1px solid #B8CCEE', cursor: 'pointer' }}
                onClick={() => copy('owner')}
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
          )}
        </div>

        {zipProgress && (
          <div
            className="basis-full md:basis-auto text-xs rounded-lg px-3 py-2"
            style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#7C5C3E' }}
          >
            Downloading {zipProgress.done}/{zipProgress.total}
            {zipProgress.failed > 0 ? ` · ${zipProgress.failed} skipped` : ''}
          </div>
        )}

        <div className="relative ml-auto" ref={settingsRef}>
          <button
            style={{ ...btnBase, padding: '6px 10px' }}
            onClick={() => {
              setShowSettings((s) => {
                const next = !s
                if (next) {
                  setPasswordInput('')
                  setPasswordError('')
                  setPasswordSaved(false)
                }
                return next
              })
              setShowShare(false)
            }}
            title="Settings"
          >
            <Settings className="w-4 h-4" style={{ color: '#7C5C3E' }} />
            Settings
          </button>

          {showSettings && (
            <div
              className="absolute right-0 top-full mt-2 z-50 rounded-2xl shadow-xl max-h-[78vh] overflow-y-auto"
              style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', width: 'min(92vw, 420px)', padding: 16 }}
            >
              <div className="flex items-center justify-between mb-4">
                <span className="font-semibold text-sm" style={{ color: '#254F22' }}>Album settings</span>
                <button onClick={() => setShowSettings(false)} style={{ color: '#A89880', cursor: 'pointer' }} aria-label="Close settings">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <section style={{ borderBottom: '1px solid #E8E0D2' }}>
                <button type="button" style={accordionButton} onClick={() => toggleSection('customization')}>
                  <Images className="w-4 h-4" style={{ color: '#7C5C3E' }} />
                  <span style={sectionTitle}>Customization</span>
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
                    style={{ color: '#A89880', transform: openSection === 'customization' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>

                {openSection === 'customization' && (
                  <div className="pb-4">
                    <p className="text-xs font-medium mb-2" style={{ color: '#7C5C3E' }}>Color patterns</p>
                    <div className="grid grid-cols-8 gap-2 mb-4">
                      {PRESETS.map((preset) => (
                        <button
                          key={preset.value}
                          title={preset.label}
                          onClick={() => saveBackground(preset.value)}
                          disabled={backgroundSaving}
                          style={{
                            width: '100%',
                            aspectRatio: '1',
                            borderRadius: 10,
                            background: preset.value,
                            border: bgChoice === preset.value ? '2px solid #254F22' : '1.5px solid #DDD5C5',
                            cursor: backgroundSaving ? 'wait' : 'pointer',
                            position: 'relative',
                          }}
                        >
                          {bgChoice === preset.value && (
                            <span className="absolute inset-0 flex items-center justify-center">
                              <Check className="w-4 h-4" style={{ color: isDark ? '#FFFFFF' : '#254F22' }} />
                            </span>
                          )}
                        </button>
                      ))}
                    </div>

                    <p className="text-xs font-medium mb-2" style={{ color: '#7C5C3E' }}>Stock photos</p>
                    <div className="grid grid-cols-5 gap-2 mb-3">
                      {FEATURED_STOCK_BACKGROUNDS.map((preset) => (
                        <button
                          key={preset.value}
                          title={preset.label}
                          onClick={() => chooseBackground(preset.value)}
                          disabled={backgroundSaving}
                          className="relative overflow-hidden"
                          style={{
                            width: '100%',
                            aspectRatio: '1',
                            borderRadius: 10,
                            backgroundImage: `url(${preset.src})`,
                            backgroundPosition: 'center',
                            backgroundSize: 'cover',
                            border: bgChoice === preset.value ? '2px solid #254F22' : '1.5px solid #DDD5C5',
                            cursor: backgroundSaving ? 'wait' : 'pointer',
                          }}
                        >
                          {bgChoice === preset.value && (
                            <span className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(37,79,34,0.25)' }}>
                              <Check className="w-4 h-4" style={{ color: '#FFFFFF' }} />
                            </span>
                          )}
                        </button>
                      ))}
                    </div>

                    <button
                      className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition hover:opacity-90"
                      style={{ background: '#F5F0E8', border: '1px solid #DDD5C5', color: '#254F22', cursor: 'pointer' }}
                      onClick={() => setShowBackgroundLibrary(true)}
                    >
                      <Images className="h-4 w-4" />
                      See all stock photos
                    </button>

                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium" style={{ color: '#7C5C3E' }}>Custom color</label>
                      <input
                        type="color"
                        value={currentColor}
                        onChange={(e) => saveBackground(e.target.value)}
                        style={{ width: 36, height: 28, borderRadius: 8, border: '1.5px solid #DDD5C5', cursor: 'pointer', padding: 2 }}
                      />
                      <span className="text-xs font-mono" style={{ color: '#A89880' }}>{currentColor}</span>
                      <button
                        className="ml-auto text-xs"
                        style={{ color: '#A89880', cursor: 'pointer' }}
                        onClick={() => saveBackground(null)}
                      >
                        Reset
                      </button>
                    </div>
                    {backgroundError && <p className="text-xs mt-2" style={{ color: '#C0392B' }}>{backgroundError}</p>}
                  </div>
                )}
              </section>

              <section style={{ borderBottom: '1px solid #E8E0D2' }}>
                <button type="button" style={accordionButton} onClick={() => toggleSection('files')}>
                  <Download className="w-4 h-4" style={{ color: '#7C5C3E' }} />
                  <span style={sectionTitle}>Files</span>
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
                    style={{ color: '#A89880', transform: openSection === 'files' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'files' && (
                  <div className="pb-4">
                    <button
                      className="w-full flex items-center justify-center gap-2 font-semibold rounded-xl py-3 text-sm transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: '#254F22', color: '#FDFAF5' }}
                      onClick={downloadZip}
                      disabled={zipping || photos.length === 0}
                    >
                      <Download className="w-4 h-4" />
                      {zipping ? 'Zipping...' : `Download all (${photos.length})`}
                    </button>
                  </div>
                )}
              </section>

              <section style={{ borderBottom: '1px solid #E8E0D2' }}>
                <button type="button" style={accordionButton} onClick={() => toggleSection('customUrl')}>
                  <Link2 className="w-4 h-4" style={{ color: canCustomize ? '#7C5C3E' : '#A89880' }} />
                  <span style={sectionTitle}>Custom URL</span>
                  {!canCustomize && <span className="ml-auto text-[10px] font-semibold uppercase" style={{ color: '#7C4A2D', letterSpacing: '0.06em' }}>Pro</span>}
                  <ChevronDown
                    className={canCustomize ? 'ml-auto w-4 h-4 transition-transform' : 'w-4 h-4 transition-transform'}
                    style={{ color: '#A89880', transform: openSection === 'customUrl' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'customUrl' && (
                  <div className="pb-4">
                    <p className="text-xs mb-3" style={{ color: '#7C5C3E' }}>
                      Pick a friendly path for this album. Letters, numbers, and hyphens, 3 to 40 characters.
                    </p>
                    <div className="flex items-stretch rounded-lg overflow-hidden" style={{ border: '1px solid #DDD5C5', background: '#FDFAF5', opacity: canCustomize ? 1 : 0.55 }}>
                      <span className="text-xs flex items-center px-2 select-none" style={{ color: '#A89880' }}>hushare.space/</span>
                      <input
                        type="text"
                        value={customUrlInput}
                        onChange={(e) => setCustomUrlInput(e.target.value)}
                        placeholder="anna-and-david"
                        maxLength={40}
                        disabled={!canCustomize}
                        className="flex-1 text-sm px-2 py-2 focus:outline-none disabled:cursor-not-allowed"
                        style={{ background: 'transparent', color: '#254F22' }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && canCustomize && !customUrlSaving && customUrlInput.trim()) saveCustomUrl('set')
                        }}
                      />
                    </div>
                    {customUrlError && <p className="text-xs mt-2" style={{ color: '#C0392B' }}>{customUrlError}</p>}
                    {customUrlSaved && !customUrlError && <p className="text-xs mt-2" style={{ color: '#254F22' }}>Saved.</p>}
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={() => saveCustomUrl('set')}
                        disabled={!canCustomize || customUrlSaving || !customUrlInput.trim()}
                        className="flex-1 text-sm font-semibold rounded-lg py-2 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: '#254F22', color: '#FDFAF5' }}
                      >
                        {customUrlSaving ? 'Saving...' : 'Save'}
                      </button>
                      {album.custom_slug && (
                        <button
                          onClick={() => saveCustomUrl('clear')}
                          disabled={!canCustomize || customUrlSaving}
                          className="text-sm rounded-lg py-2 px-3 transition hover:opacity-90 disabled:opacity-50"
                          style={{ background: '#F5F0E8', color: '#7C5C3E', border: '1px solid #DDD5C5' }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>

              <section style={{ borderBottom: '1px solid #E8E0D2' }}>
                <button type="button" style={accordionButton} onClick={() => toggleSection('password')}>
                  {album.password_protected ? (
                    <Lock className="w-4 h-4" style={{ color: canCustomize ? '#254F22' : '#A89880' }} />
                  ) : (
                    <LockOpen className="w-4 h-4" style={{ color: canCustomize ? '#7C5C3E' : '#A89880' }} />
                  )}
                  <span style={sectionTitle}>Password</span>
                  {!canCustomize && <span className="ml-auto text-[10px] font-semibold uppercase" style={{ color: '#7C4A2D', letterSpacing: '0.06em' }}>Pro</span>}
                  <ChevronDown
                    className={canCustomize ? 'ml-auto w-4 h-4 transition-transform' : 'w-4 h-4 transition-transform'}
                    style={{ color: '#A89880', transform: openSection === 'password' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'password' && (
                  <div className="pb-4">
                    <p className="text-xs mb-3" style={{ color: '#7C5C3E' }}>
                      Visitors will need this password to view the album. 4-128 characters.
                    </p>
                    <input
                      type="password"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder={album.password_protected ? 'New password' : 'Password'}
                      maxLength={128}
                      disabled={!canCustomize}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                      style={inputStyle}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && canCustomize && !passwordSaving && passwordInput) savePassword('set')
                      }}
                    />
                    {passwordError && <p className="text-xs mt-2" style={{ color: '#C0392B' }}>{passwordError}</p>}
                    {passwordSaved && !passwordError && <p className="text-xs mt-2" style={{ color: '#254F22' }}>Saved.</p>}
                    <div className="flex items-center gap-2 mt-3">
                      <button
                        onClick={() => savePassword('set')}
                        disabled={!canCustomize || passwordSaving || !passwordInput}
                        className="flex-1 text-sm font-semibold rounded-lg py-2 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: '#254F22', color: '#FDFAF5' }}
                      >
                        {passwordSaving ? 'Saving...' : 'Save'}
                      </button>
                      {album.password_protected && (
                        <button
                          onClick={() => savePassword('clear')}
                          disabled={!canCustomize || passwordSaving}
                          className="text-sm rounded-lg py-2 px-3 transition hover:opacity-90 disabled:opacity-50"
                          style={{ background: '#F5F0E8', color: '#7C5C3E', border: '1px solid #DDD5C5' }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>

              <section>
                <button type="button" style={accordionButton} onClick={() => toggleSection('collection')}>
                  <FolderPlus className="w-4 h-4" style={{ color: canUseCollections ? '#7C5C3E' : '#A89880' }} />
                  <span style={sectionTitle}>Create collection</span>
                  {!canUseCollections && <span className="ml-auto text-[10px] font-semibold uppercase" style={{ color: '#7C4A2D', letterSpacing: '0.06em' }}>Studio</span>}
                  <ChevronDown
                    className={canUseCollections ? 'ml-auto w-4 h-4 transition-transform' : 'w-4 h-4 transition-transform'}
                    style={{ color: '#A89880', transform: openSection === 'collection' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'collection' && (
                  <div className="pb-1">
                    <p className="text-xs mb-3" style={{ color: '#7C5C3E' }}>
                      Create a public grouped page and add this album to it.
                    </p>
                    <input
                      type="text"
                      value={collectionName}
                      onChange={(e) => setCollectionName(e.target.value)}
                      placeholder="Wedding season 2026"
                      maxLength={80}
                      disabled={!canUseCollections}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none mb-2 disabled:cursor-not-allowed disabled:opacity-60"
                      style={inputStyle}
                    />
                    <input
                      type="text"
                      value={collectionSlug}
                      onChange={(e) => setCollectionSlug(e.target.value)}
                      placeholder="collection-url"
                      maxLength={40}
                      disabled={!canUseCollections}
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
                      style={inputStyle}
                    />
                    {collectionError && <p className="text-xs mt-2" style={{ color: '#C0392B' }}>{collectionError}</p>}
                    {collectionUrl && (
                      <p className="text-xs mt-2 break-all" style={{ color: '#254F22' }}>
                        Created: <a href={collectionUrl} className="underline">{collectionUrl}</a>
                      </p>
                    )}
                    <button
                      onClick={createCollection}
                      disabled={!canUseCollections || collectionSaving || !collectionName.trim()}
                      className="mt-3 w-full text-sm font-semibold rounded-lg py-2 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: '#254F22', color: '#FDFAF5' }}
                    >
                      {collectionSaving ? 'Creating...' : 'Create collection'}
                    </button>
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>

      {showBackgroundLibrary && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center px-4 py-6"
          style={{ background: 'rgba(26, 43, 26, 0.46)', backdropFilter: 'blur(8px)' }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setShowBackgroundLibrary(false)
          }}
        >
          <div
            className="max-h-[88vh] w-full max-w-4xl overflow-y-auto rounded-2xl shadow-2xl"
            style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}
          >
            <div
              className="sticky top-0 z-10 flex items-center justify-between px-5 py-4"
              style={{ background: '#FFFFFF', borderBottom: '1px solid #E8E0D2' }}
            >
              <div>
                <h2 className="text-base font-semibold" style={{ color: '#254F22' }}>Stock backgrounds</h2>
                <p className="text-xs" style={{ color: '#7C5C3E' }}>Pick a quiet image for this album.</p>
              </div>
              <button
                onClick={() => setShowBackgroundLibrary(false)}
                className="rounded-full p-2 transition hover:opacity-80"
                style={{ color: '#7C5C3E', background: '#F5F0E8', cursor: 'pointer' }}
                aria-label="Close stock backgrounds"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
              {STOCK_ALBUM_BACKGROUNDS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  disabled={backgroundSaving}
                  onClick={() => chooseBackground(preset.value, true)}
                  className="group overflow-hidden rounded-xl text-left transition hover:opacity-95 disabled:cursor-wait"
                  style={{
                    border: bgChoice === preset.value ? '2px solid #254F22' : '1px solid #DDD5C5',
                    background: '#FDFAF5',
                    cursor: backgroundSaving ? 'wait' : 'pointer',
                  }}
                >
                  <span
                    className="relative block aspect-[4/3] w-full"
                    style={{
                      backgroundImage: `url(${preset.src})`,
                      backgroundPosition: 'center',
                      backgroundSize: 'cover',
                    }}
                  >
                    {bgChoice === preset.value && (
                      <span
                        className="absolute inset-0 flex items-center justify-center"
                        style={{ background: 'rgba(37,79,34,0.28)', color: '#FFFFFF' }}
                      >
                        <Check className="h-6 w-6" />
                      </span>
                    )}
                  </span>
                  <span className="block px-3 py-2 text-xs font-semibold" style={{ color: '#254F22' }}>
                    {preset.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, Copy, Download, FolderPlus, Images, Link2, Lock, LockOpen, Settings, Trash2, X } from 'lucide-react'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import { type Album, type Photo } from '@/lib/supabase'
import type { MediaDisplayFilter } from '@/lib/supabase'
import type { Tier } from '@/lib/subscriptions'
import { formatFileSize } from '@/lib/utils'
import BackgroundLibraryModal from '@/components/owner-toolbar/BackgroundLibraryModal'
import ShareMenu from '@/components/owner-toolbar/ShareMenu'
import {
  addAlbumToCollectionRequest,
  createCollectionRequest,
  deleteAlbumRequest,
  fetchCollections,
  saveBackgroundRequest,
  saveCustomUrlRequest,
  saveMediaSettingsRequest,
  savePasswordRequest,
  uploadBackgroundRequest,
} from '@/components/owner-toolbar/api'
import {
  BACKGROUND_IMAGE_TYPES,
  DEFAULT_BG,
  FEATURED_STOCK_BACKGROUNDS,
  MAX_BACKGROUND_BYTES,
  PRESETS,
} from '@/components/owner-toolbar/constants'
import { accordionButton, btnBase, inputStyle, sectionTitle, settingsSectionStyle } from '@/components/owner-toolbar/styles'
import type { CollectionSummary, SettingsSection } from '@/components/owner-toolbar/types'

type Props = {
  album: Album
  photos: Photo[]
  ownerToken: string
  userTier: Tier
  mediaRadiusMax: number
  onAlbumUpdated: (patch: Partial<Album>) => void
}

export default function OwnerToolbar({ album, photos, ownerToken, userTier, mediaRadiusMax, onAlbumUpdated }: Props) {
  const [copied, setCopied] = useState<'share' | 'owner' | null>(null)
  const [showShare, setShowShare] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [openSection, setOpenSection] = useState<SettingsSection | null>(null)
  const [zipping, setZipping] = useState(false)
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number; failed: number } | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deletingAlbum, setDeletingAlbum] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const [customUrlInput, setCustomUrlInput] = useState(album.custom_slug ?? '')
  const [customUrlSaving, setCustomUrlSaving] = useState(false)
  const [customUrlError, setCustomUrlError] = useState('')
  const [customUrlSaved, setCustomUrlSaved] = useState(false)

  const [passwordInput, setPasswordInput] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState('')
  const [passwordSaved, setPasswordSaved] = useState(false)

  const [collectionName, setCollectionName] = useState('')
  const [collectionDescription, setCollectionDescription] = useState('')
  const [collectionSlug, setCollectionSlug] = useState('')
  const [collectionSaving, setCollectionSaving] = useState(false)
  const [collectionError, setCollectionError] = useState('')
  const [collectionUrl, setCollectionUrl] = useState('')
  const [collections, setCollections] = useState<CollectionSummary[]>([])
  const [collectionsLoading, setCollectionsLoading] = useState(false)

  const [backgroundSaving, setBackgroundSaving] = useState(false)
  const [backgroundError, setBackgroundError] = useState('')
  const [showBackgroundLibrary, setShowBackgroundLibrary] = useState(false)
  const [mediaRadius, setMediaRadius] = useState(album.media_radius ?? 12)
  const [videoAutoplay, setVideoAutoplay] = useState(!!album.video_autoplay)
  const [mediaFilter, setMediaFilter] = useState<MediaDisplayFilter>(album.media_filter ?? 'none')
  const [mediaSaving, setMediaSaving] = useState(false)
  const [mediaError, setMediaError] = useState('')
  const [mediaSaved, setMediaSaved] = useState(false)

  const shareRef = useRef<HTMLDivElement>(null)
  const settingsRef = useRef<HTMLDivElement>(null)
  const backgroundInputRef = useRef<HTMLInputElement>(null)

  const publicSlug = album.custom_slug ?? album.slug
  const shareUrl = `${window.location.origin}/${publicSlug}`
  const ownerUrl = `${window.location.origin}/${album.slug}?owner=${ownerToken}`
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(shareUrl)}`
  const canCustomize = userTier === 'pro' || userTier === 'studio'
  const canUseCollections = userTier === 'studio'
  const bgChoice = album.background_theme ?? DEFAULT_BG
  const currentColor = bgChoice.startsWith('#') ? bgChoice : DEFAULT_BG
  const isDark = bgChoice === '#1C2333' || bgChoice === '#1A2B1A' || bgChoice.startsWith('image:') || bgChoice.startsWith('stock:')
  const radiusMax = Math.max(1, Math.round(mediaRadiusMax))

  const loadCollections = useCallback(async () => {
    setCollectionsLoading(true)
    try {
      setCollections(await fetchCollections(album.slug, ownerToken))
    } finally {
      setCollectionsLoading(false)
    }
  }, [album.slug, ownerToken])

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
      setCollectionDescription('')
      setMediaRadius(album.media_radius ?? 12)
      setVideoAutoplay(!!album.video_autoplay)
      setMediaFilter(album.media_filter ?? 'none')
      setMediaError('')
      setMediaSaved(false)
      setOpenSection(null)
      setDeleteConfirm(false)
      setDeleteError('')
    }
  }, [album.custom_slug, album.media_filter, album.media_radius, album.video_autoplay, showSettings])

  useEffect(() => {
    if (showSettings && canUseCollections) void loadCollections()
  }, [showSettings, canUseCollections, loadCollections])

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
      const result = await saveCustomUrlRequest(
        album.slug,
        ownerToken,
        action === 'clear' ? null : customUrlInput.trim().toLowerCase(),
      )
      if (!result.ok) {
        setCustomUrlError(result.error)
        return
      }
      onAlbumUpdated({ custom_slug: result.custom_slug })
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
      const result = await savePasswordRequest(
        album.slug,
        ownerToken,
        action === 'clear' ? null : passwordInput,
      )
      if (!result.ok) {
        setPasswordError(result.error)
        return
      }
      onAlbumUpdated({ password_protected: result.password_protected })
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
    const previousBackground = album.background_theme ?? null
    onAlbumUpdated({ background_theme: choice })
    try {
      const result = await saveBackgroundRequest(album.slug, ownerToken, choice)
      if (!result.ok) {
        onAlbumUpdated({ background_theme: previousBackground })
        setBackgroundError(result.error)
        return false
      }
      onAlbumUpdated({ background_theme: result.background_theme })
      return true
    } catch (e) {
      onAlbumUpdated({ background_theme: previousBackground })
      setBackgroundError(e instanceof Error ? e.message : 'Network error')
      return false
    } finally {
      setBackgroundSaving(false)
    }
  }

  async function saveMediaSettings(nextRadius = mediaRadius, nextAutoplay = videoAutoplay, nextFilter = mediaFilter) {
    setMediaSaving(true)
    setMediaError('')
    setMediaSaved(false)
    try {
      const result = await saveMediaSettingsRequest(album.slug, ownerToken, nextRadius, nextAutoplay, nextFilter)
      if (!result.ok) {
        setMediaError(result.error)
        return
      }
      setMediaRadius(result.media_radius)
      setVideoAutoplay(result.video_autoplay)
      setMediaFilter(result.media_filter)
      onAlbumUpdated({ media_radius: result.media_radius, video_autoplay: result.video_autoplay, media_filter: result.media_filter })
      setMediaSaved(true)
    } catch (e) {
      setMediaError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setMediaSaving(false)
    }
  }

  function applyMediaRadius(value: number) {
    const nextRadius = Math.max(0, Math.min(radiusMax, Math.round(value)))
    setMediaRadius(nextRadius)
    onAlbumUpdated({ media_radius: nextRadius })
    setMediaSaved(false)
  }

  async function chooseBackground(choice: string, closeLibrary = false) {
    const saved = await saveBackground(choice)
    if (saved && closeLibrary) setShowBackgroundLibrary(false)
  }

  async function uploadBackgroundImage(file: File) {
    setBackgroundError('')
    if (!BACKGROUND_IMAGE_TYPES.has(file.type)) {
      setBackgroundError('Use a JPG, PNG, WebP, or AVIF image.')
      return
    }
    if (file.size > MAX_BACKGROUND_BYTES) {
      setBackgroundError(`Background image must be ${formatFileSize(MAX_BACKGROUND_BYTES)} or smaller.`)
      return
    }

    setBackgroundSaving(true)
    try {
      const result = await uploadBackgroundRequest(album.slug, ownerToken, file)
      if (!result.ok) {
        setBackgroundError(result.error)
        return
      }
      onAlbumUpdated({ background_theme: result.background_theme })
    } catch (e) {
      setBackgroundError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setBackgroundSaving(false)
      if (backgroundInputRef.current) backgroundInputRef.current.value = ''
    }
  }

  async function createCollection() {
    setCollectionSaving(true)
    setCollectionError('')
    setCollectionUrl('')
    try {
      const result = await createCollectionRequest({
        slug: album.slug,
        ownerToken,
        name: collectionName,
        description: collectionDescription,
        collectionSlug,
      })
      if (!result.ok) {
        setCollectionError(result.error)
        return
      }
      setCollectionUrl(`${window.location.origin}/c/${result.slug}`)
      setCollectionName('')
      setCollectionDescription('')
      setCollectionSlug('')
      await loadCollections()
    } catch (e) {
      setCollectionError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setCollectionSaving(false)
    }
  }

  async function addAlbumToCollection(collectionId: string) {
    setCollectionSaving(true)
    setCollectionError('')
    setCollectionUrl('')
    try {
      const result = await addAlbumToCollectionRequest(album.slug, ownerToken, collectionId)
      if (!result.ok) {
        setCollectionError(result.error)
        return
      }
      setCollectionUrl(`${window.location.origin}/c/${result.slug}`)
      await loadCollections()
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

  async function deleteAlbum() {
    if (!deleteConfirm) {
      setDeleteConfirm(true)
      setDeleteError('')
      return
    }

    setDeletingAlbum(true)
    setDeleteError('')
    try {
      const result = await deleteAlbumRequest(album.slug, ownerToken)
      if (!result.ok) {
        setDeleteError(result.error)
        return
      }
      window.location.href = '/'
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setDeletingAlbum(false)
    }
  }

  return (
    <div style={{ background: '#F5F0E8', borderBottom: '1px solid #DDD5C5' }}>
      <div className="hush-container py-3 flex flex-wrap items-center gap-3">
        <div className="relative" ref={shareRef}>
          <button
            className="hush-press"
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
            <ShareMenu
              copied={copied}
              ownerUrl={ownerUrl}
              qrUrl={qrUrl}
              shareUrl={shareUrl}
              onClose={() => setShowShare(false)}
              onCopy={copy}
            />
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
            className="hush-press"
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
              className="hush-menu-pop absolute right-0 top-full mt-2 z-50 rounded-2xl shadow-xl max-h-[78vh] overflow-y-auto"
              style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', width: 'min(94vw, 480px)', padding: 12 }}
            >
              <div className="flex items-start justify-between gap-4 rounded-xl px-3 py-3 mb-3" style={{ background: '#FFFFFF', border: '1px solid #E8E0D2' }}>
                <div>
                  <span className="block font-semibold text-sm" style={{ color: '#254F22' }}>Album settings</span>
                  <span className="block text-xs mt-1" style={{ color: '#8B6F4E' }}>
                    Share, customize, protect, and organize this album.
                  </span>
                </div>
                <button onClick={() => setShowSettings(false)} className="shrink-0 rounded-full p-1 transition hover:opacity-80" style={{ color: '#A89880', cursor: 'pointer', background: '#F5F0E8' }} aria-label="Close settings">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('customization')}>
                  <Images className="w-4 h-4" style={{ color: '#7C5C3E' }} />
                  <span style={sectionTitle}>Customization</span>
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
                    style={{ color: '#A89880', transform: openSection === 'customization' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>

                {openSection === 'customization' && (
                  <div className="px-4 pb-4">
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
                            border: (bgChoice === preset.value || bgChoice === preset.legacyValue || bgChoice === preset.imageValue) ? '2px solid #254F22' : '1.5px solid #DDD5C5',
                            cursor: backgroundSaving ? 'wait' : 'pointer',
                          }}
                        >
                          {(bgChoice === preset.value || bgChoice === preset.legacyValue || bgChoice === preset.imageValue) && (
                            <span className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(37,79,34,0.25)' }}>
                              <Check className="w-4 h-4" style={{ color: '#FFFFFF' }} />
                            </span>
                          )}
                        </button>
                      ))}
                    </div>

                    <input
                      ref={backgroundInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/avif"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) uploadBackgroundImage(file)
                      }}
                    />

                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <button
                        className="hush-press flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: '#254F22', border: '1px solid #254F22', color: '#FDFAF5', cursor: backgroundSaving ? 'wait' : 'pointer' }}
                        onClick={() => backgroundInputRef.current?.click()}
                        disabled={backgroundSaving}
                      >
                        <Images className="h-4 w-4" />
                        {backgroundSaving ? 'Saving...' : 'Add picture'}
                      </button>
                      <button
                        className="hush-press flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold transition hover:opacity-90"
                        style={{ background: '#F5F0E8', border: '1px solid #DDD5C5', color: '#254F22', cursor: 'pointer' }}
                        onClick={() => setShowBackgroundLibrary(true)}
                      >
                        <Images className="h-4 w-4" />
                        See all
                      </button>
                    </div>

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

              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('media')}>
                  <Settings className="w-4 h-4" style={{ color: '#7C5C3E' }} />
                  <span style={sectionTitle}>Media display</span>
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
                    style={{ color: '#A89880', transform: openSection === 'media' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'media' && (
                  <div className="px-4 pb-4 space-y-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <label className="text-xs font-medium" style={{ color: '#7C5C3E' }}>Global corner radius</label>
                        <span className="text-xs font-mono" style={{ color: '#A89880' }}>{mediaRadius}px</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={radiusMax}
                        value={mediaRadius}
                        onChange={(e) => {
                          applyMediaRadius(Number(e.target.value))
                        }}
                        className="w-full"
                      />
                      <input
                        type="number"
                        min={0}
                        max={radiusMax}
                        value={mediaRadius}
                        onChange={(e) => applyMediaRadius(Number(e.target.value))}
                        className="mt-2 w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                        style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
                      />
                    </div>

                    <label className="flex items-center justify-between gap-4 rounded-xl px-3 py-3" style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', cursor: 'pointer' }}>
                      <span>
                        <span className="block text-sm font-semibold" style={{ color: '#254F22' }}>Video autoplay</span>
                        <span className="block text-xs" style={{ color: '#7C5C3E' }}>Start videos automatically when opened.</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={videoAutoplay}
                        onChange={(e) => {
                          const nextAutoplay = e.target.checked
                          setVideoAutoplay(nextAutoplay)
                          onAlbumUpdated({ video_autoplay: nextAutoplay })
                          setMediaSaved(false)
                        }}
                        className="h-4 w-4"
                      />
                    </label>

                    <div>
                      <label className="mb-2 block text-xs font-medium" style={{ color: '#7C5C3E' }}>Global filter</label>
                      <select
                        value={mediaFilter}
                        onChange={(e) => {
                          const nextFilter = e.target.value as MediaDisplayFilter
                          setMediaFilter(nextFilter)
                          onAlbumUpdated({ media_filter: nextFilter })
                          setMediaSaved(false)
                        }}
                        className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                        style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
                      >
                        <option value="none">None</option>
                        <option value="warm">Warm</option>
                        <option value="cool">Cool</option>
                        <option value="mono">Mono</option>
                        <option value="vintage">Vintage</option>
                        <option value="soft">Soft</option>
                      </select>
                    </div>

                    {mediaError && <p className="text-xs" style={{ color: '#C0392B' }}>{mediaError}</p>}
                    {mediaSaved && !mediaError && <p className="text-xs" style={{ color: '#254F22' }}>Saved.</p>}
                    <button
                      onClick={() => saveMediaSettings()}
                      disabled={mediaSaving}
                      className="hush-press w-full text-sm font-semibold rounded-lg py-2 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: '#254F22', color: '#FDFAF5' }}
                    >
                      {mediaSaving ? 'Saving...' : 'Save media display'}
                    </button>
                  </div>
                )}
              </section>

              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('files')}>
                  <Download className="w-4 h-4" style={{ color: '#7C5C3E' }} />
                  <span style={sectionTitle}>Files</span>
                  <ChevronDown
                    className="ml-auto w-4 h-4 transition-transform"
                    style={{ color: '#A89880', transform: openSection === 'files' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'files' && (
                  <div className="px-4 pb-4 space-y-3">
                    <button
                      className="hush-press w-full flex items-center justify-center gap-2 font-semibold rounded-xl py-3 text-sm transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ background: '#254F22', color: '#FDFAF5' }}
                      onClick={downloadZip}
                      disabled={zipping || photos.length === 0}
                    >
                      <Download className="w-4 h-4" />
                      {zipping ? 'Zipping...' : `Download all (${photos.length})`}
                    </button>
                    <div className="rounded-xl p-3" style={{ background: '#FFF7F4', border: '1px solid rgba(192,57,43,0.25)' }}>
                      <p className="text-xs leading-relaxed mb-3" style={{ color: '#7A2A1F' }}>
                        Delete this album, its photos and videos, and remove it from collections.
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <button
                          type="button"
                          onClick={deleteAlbum}
                          disabled={deletingAlbum}
                          className="hush-press flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-semibold transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                          style={{ background: deleteConfirm ? '#C0392B' : '#FFFFFF', border: '1px solid #C0392B', color: deleteConfirm ? '#FFFFFF' : '#C0392B' }}
                        >
                          <Trash2 className="w-4 h-4" />
                          {deletingAlbum ? 'Deleting...' : deleteConfirm ? 'Delete permanently' : 'Delete album'}
                        </button>
                        {deleteConfirm && (
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteConfirm(false)
                              setDeleteError('')
                            }}
                            className="hush-press rounded-lg px-3 py-2 text-sm font-semibold transition hover:opacity-90"
                            style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#7C5C3E' }}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                      {deleteConfirm && !deleteError && (
                        <p className="mt-2 text-xs" style={{ color: '#7A2A1F' }}>
                          Click again to confirm. This cannot be undone.
                        </p>
                      )}
                      {deleteError && <p className="mt-2 text-xs" style={{ color: '#C0392B' }}>{deleteError}</p>}
                    </div>
                  </div>
                )}
              </section>

              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('customUrl')}>
                  <Link2 className="w-4 h-4" style={{ color: canCustomize ? '#7C5C3E' : '#A89880' }} />
                  <span style={sectionTitle}>Custom URL</span>
                  {!canCustomize && <span className="ml-auto text-[10px] font-semibold uppercase" style={{ color: '#7C4A2D', letterSpacing: '0.06em' }}>Pro</span>}
                  <ChevronDown
                    className={canCustomize ? 'ml-auto w-4 h-4 transition-transform' : 'w-4 h-4 transition-transform'}
                    style={{ color: '#A89880', transform: openSection === 'customUrl' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'customUrl' && (
                  <div className="px-4 pb-4">
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
                        className="hush-press flex-1 text-sm font-semibold rounded-lg py-2 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: '#254F22', color: '#FDFAF5' }}
                      >
                        {customUrlSaving ? 'Saving...' : 'Save'}
                      </button>
                      {album.custom_slug && (
                        <button
                          onClick={() => saveCustomUrl('clear')}
                          disabled={!canCustomize || customUrlSaving}
                          className="hush-press text-sm rounded-lg py-2 px-3 transition hover:opacity-90 disabled:opacity-50"
                          style={{ background: '#F5F0E8', color: '#7C5C3E', border: '1px solid #DDD5C5' }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>

              <section style={settingsSectionStyle}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('password')}>
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
                  <div className="px-4 pb-4">
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
                        className="hush-press flex-1 text-sm font-semibold rounded-lg py-2 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: '#254F22', color: '#FDFAF5' }}
                      >
                        {passwordSaving ? 'Saving...' : 'Save'}
                      </button>
                      {album.password_protected && (
                        <button
                          onClick={() => savePassword('clear')}
                          disabled={!canCustomize || passwordSaving}
                          className="hush-press text-sm rounded-lg py-2 px-3 transition hover:opacity-90 disabled:opacity-50"
                          style={{ background: '#F5F0E8', color: '#7C5C3E', border: '1px solid #DDD5C5' }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </section>

              <section style={{ ...settingsSectionStyle, marginBottom: 0 }}>
                <button type="button" className="hush-motion" style={accordionButton} onClick={() => toggleSection('collection')}>
                  <FolderPlus className="w-4 h-4" style={{ color: canUseCollections ? '#7C5C3E' : '#A89880' }} />
                  <span style={sectionTitle}>Collections</span>
                  {!canUseCollections && <span className="ml-auto text-[10px] font-semibold uppercase" style={{ color: '#7C4A2D', letterSpacing: '0.06em' }}>Studio</span>}
                  <ChevronDown
                    className={canUseCollections ? 'ml-auto w-4 h-4 transition-transform' : 'w-4 h-4 transition-transform'}
                    style={{ color: '#A89880', transform: openSection === 'collection' ? 'rotate(180deg)' : 'rotate(0deg)' }}
                  />
                </button>
                {openSection === 'collection' && (
                  <div className="px-4 pb-4">
                    <p className="text-xs mb-3" style={{ color: '#7C5C3E' }}>
                      Create a grouped /c/... page, or add this album to one you already use.
                    </p>

                    {canUseCollections && (
                      <div className="mb-4 rounded-xl p-3" style={{ background: '#FDFAF5', border: '1px solid #E8E0D2' }}>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: '#8B6F4E' }}>Your collections</span>
                          {collectionsLoading && <span className="text-xs" style={{ color: '#A89880' }}>Loading...</span>}
                        </div>
                        <div className="space-y-2">
                          {collections.map((collection) => (
                            <button
                              key={collection.id}
                              type="button"
                              onClick={() => addAlbumToCollection(collection.id)}
                              disabled={collectionSaving || collection.contains_album}
                              className="hush-press flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
                              style={{ background: '#FFFFFF', border: '1px solid #DDD5C5', color: '#254F22' }}
                            >
                              <span className="min-w-0">
                                <span className="block truncate font-semibold">{collection.name}</span>
                                <span className="block truncate" style={{ color: '#8B6F4E' }}>
                                  /c/{collection.slug} · {collection.album_count} album{collection.album_count === 1 ? '' : 's'}
                                </span>
                              </span>
                              <span className="shrink-0 font-semibold" style={{ color: collection.contains_album ? '#254F22' : '#7C5C3E' }}>
                                {collection.contains_album ? 'Added' : 'Add'}
                              </span>
                            </button>
                          ))}
                          {!collectionsLoading && collections.length === 0 && (
                            <p className="text-xs" style={{ color: '#8B6F4E' }}>No collections yet. Create the first one below.</p>
                          )}
                        </div>
                      </div>
                    )}

                    <p className="text-xs font-semibold uppercase tracking-[0.08em] mb-2" style={{ color: '#8B6F4E' }}>
                      New collection
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
                    <textarea
                      value={collectionDescription}
                      onChange={(e) => setCollectionDescription(e.target.value)}
                      placeholder="Short description for the public collection page"
                      maxLength={240}
                      disabled={!canUseCollections}
                      rows={3}
                      className="w-full resize-none rounded-lg px-3 py-2 text-sm focus:outline-none mb-2 disabled:cursor-not-allowed disabled:opacity-60"
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
                      className="hush-press mt-3 w-full text-sm font-semibold rounded-lg py-2 transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
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
        <BackgroundLibraryModal
          backgroundSaving={backgroundSaving}
          bgChoice={bgChoice}
          onChoose={chooseBackground}
          onClose={() => setShowBackgroundLibrary(false)}
        />
      )}
    </div>
  )
}

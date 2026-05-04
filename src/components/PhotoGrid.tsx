'use client'

import { useState, useEffect, useCallback } from 'react'
import { type Album, type MediaDisplayFilter, type Photo } from '@/lib/supabase'
import { formatDuration } from '@/lib/media'
import Image from 'next/image'
import { Download, Trash2, X, ChevronLeft, ChevronRight, Play, Settings } from 'lucide-react'

type Props = {
  album: Album
  photos: Photo[]
  isOwner: boolean
  slug: string
  ownerToken: string | null
  onPhotoDeleted: (id: string) => void
  onPhotoUpdated: (id: string, patch: Partial<Photo>) => void
}

const FILTER_OPTIONS: Array<{ value: MediaDisplayFilter; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'warm', label: 'Warm' },
  { value: 'cool', label: 'Cool' },
  { value: 'mono', label: 'Mono' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'soft', label: 'Soft' },
]
type PhotoFilterChoice = MediaDisplayFilter | 'global'

function cssFilter(filter: MediaDisplayFilter | null | undefined): string {
  switch (filter) {
    case 'warm':
      return 'sepia(0.18) saturate(1.12) contrast(1.02)'
    case 'cool':
      return 'saturate(1.05) hue-rotate(8deg) contrast(1.02)'
    case 'mono':
      return 'grayscale(1) contrast(1.04)'
    case 'vintage':
      return 'sepia(0.32) saturate(0.92) contrast(1.08)'
    case 'soft':
      return 'saturate(0.94) brightness(1.04) contrast(0.94)'
    default:
      return 'none'
  }
}

function radiusFor(photo: Photo, album: Album): number {
  return photo.display_radius ?? album.media_radius ?? 12
}

function filterFor(photo: Photo, album: Album): MediaDisplayFilter {
  return photo.display_filter ?? album.media_filter ?? 'none'
}

export default function PhotoGrid({ album, photos, isOwner, slug, ownerToken, onPhotoDeleted, onPhotoUpdated }: Props) {
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const [settingsPhoto, setSettingsPhoto] = useState<Photo | null>(null)
  const [settingsRadius, setSettingsRadius] = useState(album.media_radius ?? 12)
  const [settingsFilter, setSettingsFilter] = useState<PhotoFilterChoice>('global')
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState('')

  function openSettings(photo: Photo) {
    setSettingsPhoto(photo)
    setSettingsRadius(radiusFor(photo, album))
    setSettingsFilter(photo.display_filter ?? 'global')
    setSettingsError('')
  }

  function previewRadiusFor(photo: Photo): number {
    if (settingsPhoto?.id === photo.id) return settingsRadius
    return radiusFor(photo, album)
  }

  function previewFilterFor(photo: Photo): MediaDisplayFilter {
    if (settingsPhoto?.id === photo.id) {
      return settingsFilter === 'global' ? album.media_filter ?? 'none' : settingsFilter
    }
    return filterFor(photo, album)
  }

  async function savePhotoSettings() {
    if (!settingsPhoto || !ownerToken) return
    setSettingsSaving(true)
    setSettingsError('')
    try {
      const res = await fetch('/api/album/photo/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          owner_token: ownerToken,
          photo_id: settingsPhoto.id,
          display_radius: settingsRadius === (album.media_radius ?? 12) ? null : settingsRadius,
          display_filter: settingsFilter === 'global' ? null : settingsFilter,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        display_radius?: number | null
        display_filter?: MediaDisplayFilter | null
      }
      if (!res.ok) {
        setSettingsError(body.error ?? `Save failed (${res.status})`)
        return
      }
      onPhotoUpdated(settingsPhoto.id, {
        display_radius: body.display_radius ?? null,
        display_filter: body.display_filter ?? null,
      })
      setSettingsPhoto(null)
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setSettingsSaving(false)
    }
  }

  async function deletePhoto(photo: Photo) {
    if (!ownerToken) return
    setDeleting(photo.id)

    const res = await fetch('/api/album/photo/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, owner_token: ownerToken, photo_id: photo.id }),
    })

    if (res.ok) {
      onPhotoDeleted(photo.id)
      if (lightbox !== null) setLightbox(null)
    }
    // On failure we leave the photo visible — better than silently lying.
    // A future improvement: surface a toast or inline error.

    setDeleting(null)
  }

  function downloadPhoto(photo: Photo) {
    const a = document.createElement('a')
    a.href = photo.url
    a.download = photo.caption || (photo.media_type === 'video' ? 'video' : 'photo')
    a.target = '_blank'
    a.click()
  }

  function markBroken(photoId: string) {
    setBroken((current) => {
      if (current.has(photoId)) return current
      const nextBroken = new Set(current)
      nextBroken.add(photoId)
      return nextBroken
    })
  }

  const prev = useCallback(() => {
    setLightbox((cur) => (cur === null ? null : cur === 0 ? photos.length - 1 : cur - 1))
  }, [photos.length])

  const next = useCallback(() => {
    setLightbox((cur) => (cur === null ? null : cur === photos.length - 1 ? 0 : cur + 1))
  }, [photos.length])

  // Keyboard navigation while the lightbox is open. Skip if focus is in a
  // form field so arrow keys still work for editing inputs elsewhere.
  useEffect(() => {
    if (lightbox === null) return
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next() }
      else if (e.key === 'Escape') { e.preventDefault(); setLightbox(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, prev, next])

  if (photos.length === 0) {
    return (
      <div className="text-center py-20" style={{ color: '#A89880' }}>
        <p className="text-lg">Nothing here yet.</p>
        <p className="text-sm mt-1">Be the first to upload a photo or video!</p>
      </div>
    )
  }

  const current = lightbox !== null ? photos[lightbox] : null

  return (
    <>
      <div className="hush-photo-grid grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3 xl:gap-4">
        {photos.map((photo, index) => {
          const isVideo = photo.media_type === 'video'
          const thumbSrc = isVideo ? photo.poster_url || '' : photo.url
          const isBroken = broken.has(photo.id)
          const mediaRadius = previewRadiusFor(photo)
          const filter = cssFilter(previewFilterFor(photo))
          return (
            <div key={photo.id}>
              <div
                className="hush-hover-lift hush-photo-tile group relative aspect-square overflow-hidden cursor-pointer"
                style={{ background: '#EDE7DB', borderRadius: mediaRadius }}
                onClick={() => setLightbox(index)}
              >
                {thumbSrc && !isBroken ? (
                  <Image
                    src={thumbSrc}
                    alt={photo.caption || ''}
                    fill
                    sizes="(min-width: 1536px) 16vw, (min-width: 1280px) 20vw, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw"
                    className="object-cover transition group-hover:scale-105"
                    style={{ filter }}
                    unoptimized
                    onError={() => {
                      if (!isVideo) markBroken(photo.id)
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 px-3 text-center" style={{ background: '#E8E0D2' }}>
                    {isVideo ? <Play className="w-8 h-8" style={{ color: '#7C5C3E' }} /> : null}
                    <span className="text-xs font-semibold" style={{ color: '#7C5C3E' }}>
                      {isBroken ? 'File unavailable' : 'Preview unavailable'}
                    </span>
                  </div>
                )}

                {isVideo && (
                  <>
                    <span
                      className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    >
                      <span
                        className="rounded-full flex items-center justify-center transition group-hover:scale-110"
                        style={{
                          width: 44,
                          height: 44,
                          background: 'rgba(0,0,0,0.55)',
                          backdropFilter: 'blur(4px)',
                          WebkitBackdropFilter: 'blur(4px)',
                        }}
                      >
                        <Play className="w-5 h-5" style={{ color: '#FDFAF5', marginLeft: 2 }} fill="#FDFAF5" />
                      </span>
                    </span>
                    {photo.duration_seconds ? (
                      <span
                        className="absolute top-2 right-2 text-[10px] font-medium px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(0,0,0,0.65)', color: '#FDFAF5' }}
                      >
                        {formatDuration(photo.duration_seconds)}
                      </span>
                    ) : null}
                  </>
                )}

                <div className="absolute inset-0 transition" style={{ background: 'rgba(0,0,0,0)' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,0,0,0.18)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'rgba(0,0,0,0)')}
                />
                {(photo.caption || photo.author_name) && (
                  <div className="absolute bottom-0 left-0 right-0 p-2 translate-y-full group-hover:translate-y-0 transition"
                    style={{ background: 'linear-gradient(to top, rgba(37,79,34,0.85), transparent)' }}>
                    {photo.caption && <p className="text-xs font-medium truncate" style={{ color: '#FDFAF5' }}>{photo.caption}</p>}
                    {photo.author_name && <p className="text-xs truncate" style={{ color: '#C5D9C2' }}>by {photo.author_name}</p>}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {current && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setLightbox(null)}>
          {/* Lightly softened backdrop: the current item's still image, dimmed
              for contrast. For videos we use the poster if one exists. */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              backgroundImage: `url(${current.media_type === 'video' ? (current.poster_url || '') : current.url})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(10px) saturate(1.05)',
              transform: 'scale(1.05)',
            }}
          />
          <div aria-hidden className="absolute inset-0" style={{ background: 'rgba(12, 16, 12, 0.50)' }} />

          <button
            type="button"
            aria-label="Close"
            className="absolute top-4 right-4 z-20 flex items-center justify-center rounded-full transition hover:opacity-80"
            style={{
              width: 42,
              height: 42,
              background: 'rgba(15,20,15,0.68)',
              border: '1px solid rgba(253,250,245,0.35)',
              color: '#FDFAF5',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
            onClick={(e) => { e.stopPropagation(); setLightbox(null) }}
          >
            <X className="w-5 h-5" />
          </button>
          <button className="absolute left-4 z-10 transition hover:opacity-70 p-2" style={{ color: '#FDFAF5' }} onClick={(e) => { e.stopPropagation(); prev() }}>
            <ChevronLeft className="w-8 h-8" />
          </button>
          <button className="absolute right-4 z-10 transition hover:opacity-70 p-2" style={{ color: '#FDFAF5' }} onClick={(e) => { e.stopPropagation(); next() }}>
            <ChevronRight className="w-8 h-8" />
          </button>

          <div className="hush-modal-pop relative z-10 max-w-[min(96vw,1100px)] max-h-[80vh] mx-4 sm:mx-16 flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
            {broken.has(current.id) ? (
              <div className="flex min-h-[240px] w-[min(92vw,720px)] flex-col items-center justify-center px-6 text-center" style={{ background: 'rgba(253,250,245,0.94)', borderRadius: previewRadiusFor(current) }}>
                <p className="font-semibold" style={{ color: '#254F22' }}>This file is unavailable</p>
                <p className="mt-2 text-sm" style={{ color: '#7C5C3E' }}>The album row still exists, but the storage object could not be loaded.</p>
              </div>
            ) : current.media_type === 'video' ? (
              <video
                key={current.id}
                src={current.url}
                poster={current.poster_url || undefined}
                controls
                autoPlay={!!album.video_autoplay}
                playsInline
                className="max-h-[70vh] max-w-full"
                style={{ background: '#000', borderRadius: previewRadiusFor(current), filter: cssFilter(previewFilterFor(current)) }}
              />
            ) : (
              <div className="flex h-[70vh] w-[min(92vw,1100px)] items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={current.url}
                  alt={current.caption || ''}
                  className="block max-h-full max-w-full object-contain"
                  style={{
                    borderRadius: previewRadiusFor(current),
                    filter: cssFilter(previewFilterFor(current)),
                  }}
                  onError={() => markBroken(current.id)}
                />
              </div>
            )}

            <div className="flex items-center gap-4">
              {(current.caption || current.author_name) && (
                <div className="text-center">
                  {current.caption && <p className="font-medium" style={{ color: '#FDFAF5' }}>{current.caption}</p>}
                  {current.author_name && <p className="text-sm" style={{ color: '#C5D9C2' }}>by {current.author_name}</p>}
                </div>
              )}
              <button onClick={() => downloadPhoto(current)} disabled={broken.has(current.id)} className="p-2 rounded-lg transition hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: 'rgba(255,255,255,0.15)', color: '#FDFAF5' }} title="Download">
                <Download className="w-5 h-5" />
              </button>
              {isOwner && (
                <>
                  <button onClick={() => openSettings(current)} className="p-2 rounded-lg transition hover:opacity-80" style={{ background: 'rgba(255,255,255,0.15)', color: '#FDFAF5' }} title="Settings">
                    <Settings className="w-5 h-5" />
                  </button>
                  <button onClick={() => deletePhoto(current)} disabled={deleting === current.id} className="p-2 rounded-lg transition hover:opacity-80 disabled:opacity-50" style={{ background: 'rgba(192,57,43,0.3)', color: '#FDFAF5' }} title="Delete">
                    <Trash2 className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>

            <p className="text-sm" style={{ color: '#8AB585' }}>{(lightbox ?? 0) + 1} / {photos.length}</p>
          </div>
        </div>
      )}

      {settingsPhoto && isOwner && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4 py-6" style={{ background: 'rgba(26, 43, 26, 0.42)', backdropFilter: 'blur(8px)' }} onMouseDown={(e) => {
          if (e.target === e.currentTarget) setSettingsPhoto(null)
        }}>
          <div className="hush-modal-pop w-full max-w-sm rounded-2xl shadow-2xl" style={{ background: '#FFFFFF', border: '1px solid #DDD5C5' }}>
            <div className="flex items-center justify-between gap-3 px-5 py-4" style={{ borderBottom: '1px solid #E8E0D2' }}>
              <div>
                <h2 className="text-base font-semibold" style={{ color: '#254F22' }}>Media settings</h2>
                <p className="text-xs" style={{ color: '#7C5C3E' }}>Only this item.</p>
              </div>
              <button type="button" onClick={() => setSettingsPhoto(null)} className="rounded-full p-2 transition hover:opacity-80" style={{ color: '#7C5C3E', background: '#F5F0E8' }} aria-label="Close media settings">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 p-5">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label className="text-xs font-medium" style={{ color: '#7C5C3E' }}>Corner radius</label>
                  <span className="text-xs font-mono" style={{ color: '#A89880' }}>{settingsRadius}px</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={999}
                  value={settingsRadius}
                  onChange={(e) => setSettingsRadius(Number(e.target.value))}
                  className="w-full"
                />
                <button type="button" onClick={() => setSettingsRadius(album.media_radius ?? 12)} className="mt-2 text-xs" style={{ color: '#A89880' }}>
                  Use global radius
                </button>
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium" style={{ color: '#7C5C3E' }}>Filter</label>
                <select
                  value={settingsFilter}
                  onChange={(e) => setSettingsFilter(e.target.value as PhotoFilterChoice)}
                  className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                  style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', color: '#254F22' }}
                >
                  <option value="global">Use global ({FILTER_OPTIONS.find((option) => option.value === (album.media_filter ?? 'none'))?.label ?? 'None'})</option>
                  {FILTER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              {settingsError && <p className="text-xs" style={{ color: '#C0392B' }}>{settingsError}</p>}
              <button
                type="button"
                onClick={savePhotoSettings}
                disabled={settingsSaving}
                className="hush-press w-full rounded-lg py-2 text-sm font-semibold transition hover:opacity-90 disabled:opacity-50"
                style={{ background: '#254F22', color: '#FDFAF5' }}
              >
                {settingsSaving ? 'Saving...' : 'Save settings'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

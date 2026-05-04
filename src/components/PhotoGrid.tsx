'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { type Album, type Photo } from '@/lib/supabase'
import { cssMediaDisplayFilter, type MediaDisplayFilter } from '@/lib/media-display'
import { formatDuration } from '@/lib/media'
import { showAppToast } from '@/components/AppToast'
import PhotoSettingsModal, { type PhotoFilterChoice } from '@/components/photo-grid/PhotoSettingsModal'
import Image from 'next/image'
import { Download, Trash2, X, ChevronLeft, ChevronRight, Play, Settings } from 'lucide-react'

type Props = {
  album: Album
  photos: Photo[]
  isOwner: boolean
  slug: string
  ownerToken: string | null
  forceGlobalRadius: boolean
  onRadiusMaxChange: (max: number) => void
  onPhotoDeleted: (id: string) => void
  onPhotoUpdated: (id: string, patch: Partial<Photo>) => void
}

function radiusFor(photo: Photo, album: Album, forceGlobalRadius = false): number {
  return forceGlobalRadius ? album.media_radius ?? 12 : photo.display_radius ?? album.media_radius ?? 12
}

function filterFor(photo: Photo, album: Album): MediaDisplayFilter {
  return photo.display_filter ?? album.media_filter ?? 'none'
}

function mediaImageClass(hover: Album['media_hover']): string {
  const classes = ['hush-media-img', 'object-cover']
  if (hover === 'zoom') classes.push('hush-media-hover-zoom')
  if (hover === 'mono') classes.push('hush-media-hover-mono')
  return classes.join(' ')
}

export default function PhotoGrid({ album, photos, isOwner, slug, ownerToken, forceGlobalRadius, onRadiusMaxChange, onPhotoDeleted, onPhotoUpdated }: Props) {
  const gridRef = useRef<HTMLDivElement>(null)
  const swipeRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const lightboxHistoryRef = useRef(false)
  const longPressTimerRef = useRef<number | null>(null)
  const suppressNextClickRef = useRef(false)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [swipeAnimating, setSwipeAnimating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deletePromptPhoto, setDeletePromptPhoto] = useState<Photo | null>(null)
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const [tileRadiusMaxById, setTileRadiusMaxById] = useState<Record<string, number>>({})
  const [lightboxMediaNode, setLightboxMediaNode] = useState<HTMLElement | null>(null)
  const [lightboxRadiusMax, setLightboxRadiusMax] = useState<number | null>(null)
  const [settingsPhoto, setSettingsPhoto] = useState<Photo | null>(null)
  const [settingsRadius, setSettingsRadius] = useState(album.media_radius ?? 12)
  const [settingsFilter, setSettingsFilter] = useState<PhotoFilterChoice>('global')
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState('')

  function openSettings(photo: Photo) {
    setSettingsPhoto(photo)
    setSettingsRadius(radiusFor(photo, album, forceGlobalRadius))
    setSettingsFilter(photo.display_filter ?? 'global')
    setSettingsError('')
  }

  function previewRadiusFor(photo: Photo): number {
    if (settingsPhoto?.id === photo.id) return settingsRadius
    return radiusFor(photo, album, forceGlobalRadius)
  }

  function previewFilterFor(photo: Photo): MediaDisplayFilter {
    if (settingsPhoto?.id === photo.id) {
      return settingsFilter === 'global' ? album.media_filter ?? 'none' : settingsFilter
    }
    return filterFor(photo, album)
  }

  function radiusMaxFor(photo: Photo): number {
    if (lightbox !== null && photos[lightbox]?.id === photo.id && lightboxRadiusMax != null) {
      return lightboxRadiusMax
    }
    return Math.max(1, Math.round(tileRadiusMaxById[photo.id] ?? 144))
  }

  function applySettingsRadius(value: number) {
    if (!settingsPhoto) return
    const max = radiusMaxFor(settingsPhoto)
    setSettingsRadius(Math.max(0, Math.min(max, Math.round(value))))
  }

  const closeLightbox = useCallback(() => {
    setLightbox(null)
    if (lightboxHistoryRef.current) {
      lightboxHistoryRef.current = false
      window.history.back()
    }
  }, [])

  function openLightbox(index: number) {
    setLightbox(index)
    if (!lightboxHistoryRef.current) {
      window.history.pushState({ hushLightbox: true }, '', window.location.href)
      lightboxHistoryRef.current = true
    }
  }

  function clearLongPressTimer() {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }

  function startLongPress(photo: Photo) {
    if (!isOwner || !ownerToken) return
    clearLongPressTimer()
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null
      suppressNextClickRef.current = true
      setDeletePromptPhoto(photo)
    }, 560)
  }

  function handleTileClick(index: number) {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false
      return
    }
    openLightbox(index)
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
        showAppToast(body.error ?? `Save failed (${res.status})`, 'error')
        return
      }
      onPhotoUpdated(settingsPhoto.id, {
        display_radius: body.display_radius ?? null,
        display_filter: body.display_filter ?? null,
      })
      showAppToast('Media settings saved.')
      setSettingsPhoto(null)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Network error'
      setSettingsError(message)
      showAppToast(message, 'error')
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
      if (lightbox !== null) closeLightbox()
      showAppToast('Media deleted.')
    } else {
      showAppToast(`Delete failed (${res.status})`, 'error')
    }

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

  function handleSwipeStart(e: React.TouchEvent<HTMLDivElement>) {
    if (e.touches.length !== 1) return
    const touch = e.touches[0]
    swipeRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() }
    setSwipeAnimating(false)
    setSwipeOffset(0)
  }

  function handleSwipeMove(e: React.TouchEvent<HTMLDivElement>) {
    const start = swipeRef.current
    if (!start || e.touches.length !== 1) return

    const touch = e.touches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) < 8 || Math.abs(deltaX) < Math.abs(deltaY)) return

    setSwipeOffset(deltaX)
  }

  function handleSwipeEnd(e: React.TouchEvent<HTMLDivElement>) {
    const start = swipeRef.current
    swipeRef.current = null
    if (!start || e.changedTouches.length !== 1) {
      setSwipeOffset(0)
      return
    }

    const touch = e.changedTouches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    const elapsed = Date.now() - start.time
    const velocity = Math.abs(deltaX) / Math.max(1, elapsed)
    const isHorizontalSwipe = Math.abs(deltaX) >= 42 && Math.abs(deltaX) > Math.abs(deltaY) * 1.15
    if (!isHorizontalSwipe && velocity < 0.42) {
      setSwipeAnimating(true)
      setSwipeOffset(0)
      window.setTimeout(() => setSwipeAnimating(false), 180)
      return
    }

    const direction = deltaX < 0 ? -1 : 1
    setSwipeAnimating(true)
    setSwipeOffset(direction * window.innerWidth)
    window.setTimeout(() => {
      if (direction < 0) next()
      else prev()
      setSwipeAnimating(false)
      setSwipeOffset(0)
    }, 150)
  }

  useEffect(() => {
    if (lightbox === null) return
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); prev() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next() }
      else if (e.key === 'Escape') { e.preventDefault(); closeLightbox() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, prev, next, closeLightbox])

  useEffect(() => {
    function onPopState() {
      if (!lightboxHistoryRef.current) return
      lightboxHistoryRef.current = false
      setLightbox(null)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => () => clearLongPressTimer(), [])

  const current = lightbox !== null ? photos[lightbox] : null

  useEffect(() => {
    const maybeGrid = gridRef.current
    if (!maybeGrid) return
    const grid = maybeGrid

    function measureTiles() {
      const nextCaps: Record<string, number> = {}
      let globalMax = 1
      grid.querySelectorAll<HTMLElement>('[data-photo-id]').forEach((tile) => {
        const id = tile.dataset.photoId
        if (!id) return
        const rect = tile.getBoundingClientRect()
        const cap = Math.max(1, Math.ceil(Math.min(rect.width, rect.height) / 2))
        nextCaps[id] = cap
        globalMax = Math.max(globalMax, cap)
      })
      setTileRadiusMaxById(nextCaps)
      onRadiusMaxChange(globalMax)
    }

    measureTiles()
    const observer = new ResizeObserver(measureTiles)
    observer.observe(grid)
    grid.querySelectorAll<HTMLElement>('[data-photo-id]').forEach((tile) => observer.observe(tile))
    window.addEventListener('resize', measureTiles)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measureTiles)
    }
  }, [photos, onRadiusMaxChange])

  useEffect(() => {
    setLightboxMediaNode(null)
    setLightboxRadiusMax(null)
    setSwipeAnimating(false)
    setSwipeOffset(0)
  }, [current?.id])

  useEffect(() => {
    const maybeMediaNode = lightboxMediaNode
    if (!maybeMediaNode) return
    const mediaNode = maybeMediaNode

    function measureLightboxMedia() {
      const rect = mediaNode.getBoundingClientRect()
      const cap = Math.max(1, Math.ceil(Math.min(rect.width, rect.height) / 2))
      setLightboxRadiusMax(cap)
    }

    measureLightboxMedia()
    const observer = new ResizeObserver(measureLightboxMedia)
    observer.observe(mediaNode)
    window.addEventListener('resize', measureLightboxMedia)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measureLightboxMedia)
    }
  }, [lightboxMediaNode])

  useEffect(() => {
    if (!settingsPhoto) return
    const max = lightbox !== null && photos[lightbox]?.id === settingsPhoto.id && lightboxRadiusMax != null
      ? lightboxRadiusMax
      : Math.max(1, Math.round(tileRadiusMaxById[settingsPhoto.id] ?? 144))
    if (settingsRadius > max) setSettingsRadius(max)
  }, [lightbox, lightboxRadiusMax, photos, settingsPhoto, settingsRadius, tileRadiusMaxById])

  if (photos.length === 0) {
    return (
      <div className="text-center py-20" style={{ color: '#A89880' }}>
        <p className="text-lg">Nothing here yet.</p>
        <p className="text-sm mt-1">Be the first to upload a photo or video!</p>
      </div>
    )
  }

  return (
    <>
      <div
        ref={gridRef}
        className="hush-photo-grid grid gap-3 xl:gap-4"
        style={{ '--hush-grid-cols': album.mobile_grid_columns ?? 3 } as React.CSSProperties}
      >
        {photos.map((photo, index) => {
          const isVideo = photo.media_type === 'video'
          const thumbSrc = isVideo ? photo.poster_url || '' : photo.url
          const isBroken = broken.has(photo.id)
          const mediaRadius = previewRadiusFor(photo)
          const filter = cssMediaDisplayFilter(previewFilterFor(photo))
          const hover = album.media_hover ?? 'none'
          return (
            <div key={photo.id}>
              <div
                className={`${hover === 'lift' ? 'hush-hover-lift ' : ''}hush-photo-tile group relative aspect-square overflow-hidden cursor-pointer`}
                data-photo-id={photo.id}
                style={{ background: '#EDE7DB', borderRadius: mediaRadius }}
                onClick={() => handleTileClick(index)}
                onTouchStart={() => startLongPress(photo)}
                onTouchMove={clearLongPressTimer}
                onTouchEnd={clearLongPressTimer}
                onTouchCancel={clearLongPressTimer}
                onMouseDown={() => startLongPress(photo)}
                onMouseLeave={clearLongPressTimer}
                onMouseUp={clearLongPressTimer}
                onContextMenu={(e) => {
                  if (isOwner) e.preventDefault()
                }}
              >
                {thumbSrc && !isBroken ? (
                  <Image
                    src={thumbSrc}
                    alt={photo.caption || ''}
                    fill
                    sizes="(min-width: 1536px) 16vw, (min-width: 1280px) 20vw, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw"
                    className={mediaImageClass(hover)}
                    style={{ '--hush-media-filter': filter } as React.CSSProperties}
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
                        className={`rounded-full flex items-center justify-center${hover === 'zoom' ? ' transition group-hover:scale-110' : ''}`}
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

                {hover === 'fade' && (
                  <div className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none" style={{ background: 'rgba(0,0,0,0.18)' }} />
                )}
                {hover !== 'none' && (photo.caption || photo.author_name) && (
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

      {deletePromptPhoto && isOwner && (
        <div className="fixed inset-x-3 bottom-4 z-[70] mx-auto max-w-sm rounded-2xl p-3 shadow-2xl" style={{ background: '#FDFAF5', border: '1px solid #DDD5C5' }}>
          <p className="px-1 text-sm font-semibold" style={{ color: '#254F22' }}>Delete this media?</p>
          <p className="mt-1 px-1 text-xs" style={{ color: '#7C5C3E' }}>This removes only the selected picture or video.</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="hush-press rounded-xl py-2 text-sm font-semibold"
              style={{ background: '#F5F0E8', border: '1px solid #DDD5C5', color: '#254F22' }}
              onClick={() => setDeletePromptPhoto(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={deleting === deletePromptPhoto.id}
              className="hush-press rounded-xl py-2 text-sm font-semibold disabled:opacity-50"
              style={{ background: '#C0392B', border: '1px solid #C0392B', color: '#FDFAF5' }}
              onClick={() => {
                const target = deletePromptPhoto
                setDeletePromptPhoto(null)
                void deletePhoto(target)
              }}
            >
              {deleting === deletePromptPhoto.id ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      )}

      {current && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={closeLightbox}>
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
            onClick={(e) => { e.stopPropagation(); closeLightbox() }}
          >
            <X className="w-5 h-5" />
          </button>
          <button className="absolute left-4 z-10 transition hover:opacity-70 p-2" style={{ color: '#FDFAF5' }} onClick={(e) => { e.stopPropagation(); prev() }}>
            <ChevronLeft className="w-8 h-8" />
          </button>
          <button className="absolute right-4 z-10 transition hover:opacity-70 p-2" style={{ color: '#FDFAF5' }} onClick={(e) => { e.stopPropagation(); next() }}>
            <ChevronRight className="w-8 h-8" />
          </button>

          <div
            className="hush-modal-pop relative z-10 max-w-[min(96vw,1100px)] max-h-[80vh] mx-4 sm:mx-16 flex flex-col items-center gap-4"
            style={{
              touchAction: 'pan-y',
              transform: `translateX(${swipeOffset}px) scale(${Math.max(0.94, 1 - Math.min(Math.abs(swipeOffset), 180) / 1800)})`,
              transition: swipeAnimating ? 'transform 150ms ease-out' : 'none',
            }}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleSwipeStart}
            onTouchMove={handleSwipeMove}
            onTouchEnd={handleSwipeEnd}
            onTouchCancel={() => {
              swipeRef.current = null
              setSwipeAnimating(true)
              setSwipeOffset(0)
              window.setTimeout(() => setSwipeAnimating(false), 180)
            }}
          >
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
                ref={(node) => setLightboxMediaNode(node)}
                style={{ background: '#000', borderRadius: previewRadiusFor(current), filter: cssMediaDisplayFilter(previewFilterFor(current)) }}
              />
            ) : (
              <div className="flex h-[70vh] w-[min(92vw,1100px)] items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={current.url}
                  alt={current.caption || ''}
                  className="block max-h-full max-w-full object-contain"
                  ref={(node) => setLightboxMediaNode(node)}
                  style={{
                    borderRadius: previewRadiusFor(current),
                    filter: cssMediaDisplayFilter(previewFilterFor(current)),
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
        <PhotoSettingsModal
          album={album}
          photo={settingsPhoto}
          radius={settingsRadius}
          filter={settingsFilter}
          saving={settingsSaving}
          error={settingsError}
          radiusMax={radiusMaxFor(settingsPhoto)}
          onClose={() => setSettingsPhoto(null)}
          onRadiusChange={applySettingsRadius}
          onRadiusReset={() => setSettingsRadius(album.media_radius ?? 12)}
          onFilterChange={setSettingsFilter}
          onSave={savePhotoSettings}
        />
      )}
    </>
  )
}

'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { type Album, type Photo } from '@/lib/supabase'
import { DEFAULT_SLIDESHOW_INTERVAL_MS, cssMediaDisplayFilter, type MediaDisplayFilter, type SlideshowAnimation } from '@/lib/media-display'
import { formatDuration } from '@/lib/media'
import { MEDIA_AUTHOR_MAX, MEDIA_CAPTION_MAX } from '@/lib/media-text'
import {
  HOLD_TO_SELECT_MS,
  HOLD_TO_SELECT_MOBILE_MS,
  SUPPRESS_CLICK_AFTER_REORDER_MS,
  SUPPRESS_CLICK_AFTER_SELECT_MS,
  SWIPE_THRESHOLD_PX,
  SWIPE_VELOCITY_MIN,
  SWIPE_RESET_ANIMATE_MS,
  GRID_PRELOAD_MARGIN_PX,
  AUTO_SCROLL_ZONE_PX,
  AUTO_SCROLL_MIN_PX_FRAME,
  AUTO_SCROLL_MAX_PX_FRAME,
} from '@/lib/constants'
import { showAppToast } from '@/components/AppToast'
import PhotoSettingsModal, { type PhotoFilterChoice } from '@/components/photo-grid/PhotoSettingsModal'
import { Download, Trash2, X, ChevronLeft, ChevronRight, Play, Pause, Check, Settings, Star, Move } from 'lucide-react'

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
  onPhotosReordered: (photos: Photo[]) => void
  slideshowRequestId?: number
  arrangeMode?: boolean
  coverPhotoId?: string | null
  onCoverSet?: (photoId: string | null) => void
}

const ARRANGE_HINT_KEY = 'hush-arrange-hint-seen'

function radiusFor(photo: Photo, album: Album, forceGlobalRadius = false): number {
  return forceGlobalRadius ? album.media_radius ?? 12 : photo.display_radius ?? album.media_radius ?? 12
}

function filterFor(photo: Photo, album: Album): MediaDisplayFilter {
  return photo.display_filter ?? album.media_filter ?? 'none'
}

function mediaImageClass(): string {
  return 'hush-media-img object-cover'
}

function streamFrameSrc(photo: Photo, autoplay: boolean): string {
  const base = photo.stream_iframe_url || (photo.stream_uid ? `https://iframe.videodelivery.net/${photo.stream_uid}` : '')
  if (!base) return ''
  const url = new URL(base)
  if (autoplay) {
    url.searchParams.set('autoplay', 'true')
    url.searchParams.set('muted', 'true')
  }
  return url.toString()
}

type Point = { x: number; y: number }

function touchDistance(touches: React.TouchList): number {
  const first = touches[0]
  const second = touches[1]
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY)
}

function touchMidpoint(touches: React.TouchList): Point {
  const first = touches[0]
  const second = touches[1]
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  }
}

function pointFromEvent(e: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>): Point | null {
  if ('touches' in e) {
    const touch = e.changedTouches[0] ?? e.touches[0]
    return touch ? { x: touch.clientX, y: touch.clientY } : null
  }
  return { x: e.clientX, y: e.clientY }
}

function pointRelativeToCenter(point: Point, node: HTMLElement): Point {
  const rect = node.getBoundingClientRect()
  return {
    x: point.x - (rect.left + rect.width / 2),
    y: point.y - (rect.top + rect.height / 2),
  }
}

export default function PhotoGrid({ album, photos, isOwner, slug, ownerToken, forceGlobalRadius, onRadiusMaxChange, onPhotoDeleted, onPhotoUpdated, onPhotosReordered, slideshowRequestId = 0, arrangeMode = false, coverPhotoId, onCoverSet }: Props) {
  const gridRef = useRef<HTMLDivElement>(null)
  const swipeRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const lightboxHistoryRef = useRef(false)
  const pinchRef = useRef<{ distance: number; scale: number; pan: Point; center: Point } | null>(null)
  const panGestureRef = useRef<{ point: Point; pan: Point; moved: boolean } | null>(null)
  const panRef = useRef<Point>({ x: 0, y: 0 })
  const lightboxVideoRef = useRef<HTMLVideoElement | null>(null)
  const slideshowTimerRef = useRef<number | null>(null)
  const slideshowTimerStartedAtRef = useRef(0)
  const slideshowRemainingMsRef = useRef<number | null>(null)
  const reorderTimerRef = useRef<number | null>(null)
  const pendingOrderRef = useRef<Photo[] | null>(null)
  const prevArrangeModeRef = useRef(arrangeMode)
  const reorderDragIdRef = useRef<string | null>(null)
  const reorderTargetIdRef = useRef<string | null>(null)
  // True only while an arrange-mode drag is in flight. reorderDragIdRef is set on ANY
  // pointer-down (even normal mode, for the hold-to-select timer), so finishReorder and
  // handleReorderMove must check this flag instead of the drag id to avoid swapping photos
  // and suppressing clicks outside arrange mode.
  const isArrangeDragRef = useRef(false)
  const autoScrollVelRef = useRef(0)   // px/frame: + = down, - = up, 0 = stopped
  const autoScrollRafRef = useRef<number | null>(null)
  const reorderSuppressedClickRef = useRef(false)
  const reorderDragPointerRef = useRef<Point | null>(null)
  const reorderDragTileSizeRef = useRef<number>(90)
  // Origin of a mobile long-press in progress. Used to distinguish a still hold (-> enter select
  // mode) from a scroll gesture. iOS fires pointercancel/pointerleave during gesture detection
  // without real movement, so we cannot rely on those to cancel; we cancel on real pointermove
  // distance instead.
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null)
  const lastTapRef = useRef(0)
  const rotateTimerRef = useRef<number | null>(null)
  const rotateTouchStartRef = useRef<Point | null>(null)
  const rotateHoldFiredRef = useRef(false)
  const handledSlideshowRequestRef = useRef(0)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [zoomScale, setZoomScale] = useState(1)
  const [zoomPan, setZoomPan] = useState<Point>({ x: 0, y: 0 })
  const [swipeOffset, setSwipeOffset] = useState(0)
  const [swipeAnimating, setSwipeAnimating] = useState(false)
  const [slideshowActive, setSlideshowActive] = useState(false)
  const [slideshowPaused, setSlideshowPaused] = useState(false)
  const [slideshowPickerOpen, setSlideshowPickerOpen] = useState(false)
  const [slideshowSelectedIds, setSlideshowSelectedIds] = useState<Set<string>>(new Set())
  const [slideshowPhotoIds, setSlideshowPhotoIds] = useState<string[] | null>(null)
  const [flippedPhotoId, setFlippedPhotoId] = useState<string | null>(null)
  const [reorderDraggingId, setReorderDraggingId] = useState<string | null>(null)
  const [reorderTargetId, setReorderTargetId] = useState<string | null>(null)
  const [reorderSaving, setReorderSaving] = useState(false)
  const [showArrangeHint, setShowArrangeHint] = useState(false)
  const [dragGhostPointer, setDragGhostPointer] = useState<Point | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [broken, setBroken] = useState<Set<string>>(new Set())
  // Separate from `broken`: when a VIDEO's poster image fails to load, we want the grid tile to
  // show the placeholder + Play icon, but the video itself should still open normally in the
  // lightbox. Using a separate state avoids marking the whole photo unavailable.
  const [posterBroken, setPosterBroken] = useState<Set<string>>(new Set())
  const [tileRadiusMaxById, setTileRadiusMaxById] = useState<Record<string, number>>({})
  const [lightboxMediaNode, setLightboxMediaNode] = useState<HTMLElement | null>(null)
  const [lightboxRadiusMax, setLightboxRadiusMax] = useState<number | null>(null)
  const [settingsPhoto, setSettingsPhoto] = useState<Photo | null>(null)
  const [settingsRadius, setSettingsRadius] = useState(album.media_radius ?? 12)
  const [settingsFilter, setSettingsFilter] = useState<PhotoFilterChoice>('global')
  const [settingsCaption, setSettingsCaption] = useState('')
  const [settingsAuthor, setSettingsAuthor] = useState('')
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [, setBulkDeleteConfirming] = useState(false)
  const [lightboxFlipped, setLightboxFlipped] = useState(false)
  const [settingCover, setSettingCover] = useState(false)
  // Photo IDs whose full-resolution original is cached in the browser. Used so the lightbox can
  // display the (already-cached) thumbnail instantly while the original loads, then swap when
  // ready. Without this, every swipe shows a blank box while the multi-MB original downloads.
  const [lightboxOriginalLoadedIds, setLightboxOriginalLoadedIds] = useState<Set<string>>(new Set())

  // Stable key over the set of photo IDs. Lets effects depend on "did the tile set change?"
  // instead of "did the photos array reference change?" — the latter happens on every realtime
  // UPDATE, which used to force a full observer rebuild + re-firing all preloads.
  const photoIdsKey = useMemo(() => photos.map((p) => p.id).join('|'), [photos])

  const viewerPhotos = slideshowPhotoIds
    ? slideshowPhotoIds
        .map((id) => photos.find((photo) => photo.id === id))
        .filter((photo): photo is Photo => Boolean(photo))
    : photos
  // Mirror viewerPhotos into a ref so the lightbox-preload effect can read the latest list
  // without depending on viewerPhotos identity (which changes every render).
  const viewerPhotosRef = useRef<Photo[]>(viewerPhotos)
  viewerPhotosRef.current = viewerPhotos
  const current = lightbox !== null ? viewerPhotos[lightbox] ?? null : null
  const overlayOpen = lightbox !== null || slideshowPickerOpen
  const slideshowMode = slideshowPhotoIds !== null
  const slideshowIntervalMs = album.slideshow_interval_ms ?? DEFAULT_SLIDESHOW_INTERVAL_MS
  const slideshowAnimation: SlideshowAnimation = album.slideshow_animation ?? 'fade'
  const slideshowFrameClass = slideshowActive && slideshowAnimation !== 'none' ? ` hush-slideshow-frame hush-slideshow-${slideshowAnimation}` : ''

  function openSettings(photo: Photo) {
    setSettingsPhoto(photo)
    setSettingsRadius(radiusFor(photo, album, forceGlobalRadius))
    setSettingsFilter(photo.display_filter ?? 'global')
    setSettingsCaption(photo.caption ?? '')
    setSettingsAuthor(photo.author_name ?? '')
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
    if (current?.id === photo.id && lightboxRadiusMax != null) {
      return lightboxRadiusMax
    }
    return Math.max(1, Math.round(tileRadiusMaxById[photo.id] ?? 144))
  }

  function applySettingsRadius(value: number) {
    if (!settingsPhoto) return
    const max = radiusMaxFor(settingsPhoto)
    setSettingsRadius(Math.max(0, Math.min(max, Math.round(value))))
  }

  const setZoomPanValue = useCallback((nextPan: Point) => {
    panRef.current = nextPan
    setZoomPan(nextPan)
  }, [])

  const resetZoom = useCallback(() => {
    setZoomScale(1)
    setZoomPanValue({ x: 0, y: 0 })
    pinchRef.current = null
    panGestureRef.current = null
  }, [setZoomPanValue])

  function clearReorderTimer() {
    if (reorderTimerRef.current != null) {
      window.clearTimeout(reorderTimerRef.current)
      reorderTimerRef.current = null
    }
  }

  function stopAutoScroll() {
    autoScrollVelRef.current = 0
    if (autoScrollRafRef.current != null) {
      cancelAnimationFrame(autoScrollRafRef.current)
      autoScrollRafRef.current = null
    }
    document.documentElement.style.scrollBehavior = ''
  }

  function updateAutoScroll(clientY: number) {
    const vh = window.innerHeight
    let vel = 0
    if (clientY < AUTO_SCROLL_ZONE_PX) {
      const t = 1 - clientY / AUTO_SCROLL_ZONE_PX
      vel = -Math.ceil(AUTO_SCROLL_MIN_PX_FRAME + (AUTO_SCROLL_MAX_PX_FRAME - AUTO_SCROLL_MIN_PX_FRAME) * t)
    } else if (clientY > vh - AUTO_SCROLL_ZONE_PX) {
      const t = 1 - (vh - clientY) / AUTO_SCROLL_ZONE_PX
      vel = Math.ceil(AUTO_SCROLL_MIN_PX_FRAME + (AUTO_SCROLL_MAX_PX_FRAME - AUTO_SCROLL_MIN_PX_FRAME) * t)
    }
    autoScrollVelRef.current = vel
    if (vel !== 0 && autoScrollRafRef.current == null) {
      const tick = () => {
        if (autoScrollVelRef.current === 0) { autoScrollRafRef.current = null; return }
        document.documentElement.style.scrollBehavior = 'auto'
        window.scrollBy(0, autoScrollVelRef.current)
        autoScrollRafRef.current = requestAnimationFrame(tick)
      }
      autoScrollRafRef.current = requestAnimationFrame(tick)
    } else if (vel === 0) {
      stopAutoScroll()
    }
  }

  function clearRotateTimer() {
    if (rotateTimerRef.current != null) {
      window.clearTimeout(rotateTimerRef.current)
      rotateTimerRef.current = null
    }
  }

  function exitSelectMode() {
    setSelectMode(false)
    setSelectedIds(new Set())
    setBulkDeleteConfirming(false)
  }

  function toggleSelection(photoId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(photoId)) next.delete(photoId)
      else next.add(photoId)
      return next
    })
  }

  async function bulkDeleteSelected() {
    if (!ownerToken || selectedIds.size === 0) return
    setBulkDeleting(true)
    const ids = [...selectedIds]
    // Server max is 200 per request — chunk just in case.
    const CHUNK = 200
    let deleted = 0
    let failed = 0
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK)
      try {
        const res = await fetch('/api/album/photo/bulk-delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, owner_token: ownerToken, photo_ids: batch }),
        })
        const body = (await res.json().catch(() => ({}))) as { deleted?: number; error?: string }
        if (res.ok && typeof body.deleted === 'number') {
          deleted += body.deleted
          for (const id of batch) onPhotoDeleted(id)
        } else {
          failed += batch.length
        }
      } catch {
        failed += batch.length
      }
    }
    setBulkDeleting(false)
    setBulkDeleteConfirming(false)
    exitSelectMode()
    if (failed > 0) showAppToast(`${deleted} deleted, ${failed} failed.`, 'error')
    else showAppToast(`${deleted} photo${deleted !== 1 ? 's' : ''} deleted.`)
  }

  async function setCoverPhoto(photo: Photo) {
    if (!ownerToken) return
    const newCoverId = coverPhotoId === photo.id ? null : photo.id
    setSettingCover(true)
    try {
      const res = await fetch('/api/album/cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, owner_token: ownerToken, photo_id: newCoverId }),
      })
      if (res.ok) {
        onCoverSet?.(newCoverId)
        showAppToast(newCoverId ? 'Set as album cover.' : 'Cover cleared.')
      } else {
        showAppToast('Could not update cover.', 'error')
      }
    } catch {
      showAppToast('Could not update cover.', 'error')
    } finally {
      setSettingCover(false)
    }
  }

  const clearSlideshowTimer = useCallback(() => {
    if (slideshowTimerRef.current === null) return
    window.clearTimeout(slideshowTimerRef.current)
    slideshowTimerRef.current = null
  }, [])

  const closeLightbox = useCallback(() => {
    clearSlideshowTimer()
    slideshowRemainingMsRef.current = null
    setSlideshowActive(false)
    setSlideshowPaused(false)
    setSlideshowPhotoIds(null)
    setFlippedPhotoId(null)
    setLightboxFlipped(false)
    setLightbox(null)
    if (lightboxHistoryRef.current) {
      lightboxHistoryRef.current = false
      window.history.back()
    }
  }, [clearSlideshowTimer])

  function openLightbox(index: number) {
    setLightbox(index)
    if (!lightboxHistoryRef.current) {
      window.history.pushState({ hushLightbox: true }, '', window.location.href)
      lightboxHistoryRef.current = true
    }
  }

  function toggleZoom(e?: React.MouseEvent<HTMLElement> | React.TouchEvent<HTMLElement>) {
    const mediaNode = lightboxMediaNode
    if (zoomScale > 1 || !mediaNode) {
      resetZoom()
      return
    }

    const point = e ? pointFromEvent(e) : null
    const nextScale = 2
    setZoomScale(nextScale)
    if (point) {
      const relative = pointRelativeToCenter(point, mediaNode)
      setZoomPanValue({
        x: -relative.x * (nextScale - 1),
        y: -relative.y * (nextScale - 1),
      })
    }
  }

  function mediaZoomStyle(photo: Photo): React.CSSProperties {
    return {
      borderRadius: previewRadiusFor(photo),
      filter: cssMediaDisplayFilter(previewFilterFor(photo)),
      transform: `translate3d(${zoomPan.x}px, ${zoomPan.y}px, 0) scale(${zoomScale})`,
      transformOrigin: 'center',
      transition: pinchRef.current || panGestureRef.current ? 'filter 180ms ease' : 'transform 160ms ease, filter 180ms ease',
      touchAction: zoomScale > 1 ? 'none' : 'pan-y',
      cursor: zoomScale > 1 ? 'zoom-out' : 'zoom-in',
    }
  }

  function handleMediaTouchStart(e: React.TouchEvent<HTMLElement>) {
    if (e.touches.length === 2) {
      e.stopPropagation()
      clearRotateTimer()
      const mediaNode = e.currentTarget
      pinchRef.current = {
        distance: touchDistance(e.touches),
        scale: zoomScale,
        pan: panRef.current,
        center: pointRelativeToCenter(touchMidpoint(e.touches), mediaNode),
      }
      panGestureRef.current = null
      return
    }
    if (zoomScale > 1) {
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
      const touch = e.touches[0]
      if (touch) panGestureRef.current = { point: { x: touch.clientX, y: touch.clientY }, pan: panRef.current, moved: false }
      return
    }
    if (e.touches.length === 1) {
      const touch = e.touches[0]
      rotateTouchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null
      clearRotateTimer()
      rotateHoldFiredRef.current = false
      rotateTimerRef.current = window.setTimeout(() => {
        rotateTimerRef.current = null
        rotateHoldFiredRef.current = true
        setLightboxFlipped(true)
      }, 600)
    }
  }

  function handleMediaTouchMove(e: React.TouchEvent<HTMLElement>) {
    if (rotateTimerRef.current !== null && e.touches.length === 1) {
      const touch = e.touches[0]
      const start = rotateTouchStartRef.current
      if (touch && start && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) {
        clearRotateTimer()
      }
    }
    if (pinchRef.current && e.touches.length === 2) {
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
      const nextScale = Math.max(1, Math.min(4, pinchRef.current.scale * (touchDistance(e.touches) / pinchRef.current.distance)))
      const ratio = nextScale / Math.max(1, pinchRef.current.scale)
      const startPan = pinchRef.current.pan
      const center = pinchRef.current.center
      setZoomScale(nextScale)
      setZoomPanValue({
        x: center.x - (center.x - startPan.x) * ratio,
        y: center.y - (center.y - startPan.y) * ratio,
      })
      return
    }

    if (panGestureRef.current && e.touches.length === 1 && zoomScale > 1) {
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
      const touch = e.touches[0]
      const deltaX = touch.clientX - panGestureRef.current.point.x
      const deltaY = touch.clientY - panGestureRef.current.point.y
      if (Math.hypot(deltaX, deltaY) > 6) panGestureRef.current.moved = true
      setZoomPanValue({
        x: panGestureRef.current.pan.x + deltaX,
        y: panGestureRef.current.pan.y + deltaY,
      })
    }
  }

  function handleMediaTouchEnd(e: React.TouchEvent<HTMLElement>) {
    clearRotateTimer()
    rotateTouchStartRef.current = null
    if (rotateHoldFiredRef.current) {
      rotateHoldFiredRef.current = false
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
      return
    }
    if (lightboxFlipped) {
      setLightboxFlipped(false)
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
      return
    }
    if (pinchRef.current) {
      e.stopPropagation()
      if (e.touches.length < 2) pinchRef.current = null
      if (zoomScale <= 1.02) resetZoom()
      return
    }

    if (panGestureRef.current) {
      e.stopPropagation()
      const wasTap = !panGestureRef.current.moved
      panGestureRef.current = null
      if (wasTap) {
        const now = Date.now()
        if (now - lastTapRef.current < 280) {
          if (e.cancelable) e.preventDefault()
          toggleZoom(e)
          lastTapRef.current = 0
        } else {
          lastTapRef.current = now
        }
      }
      return
    }

    const now = Date.now()
    if (now - lastTapRef.current < 280) {
      e.stopPropagation()
      if (e.cancelable) e.preventDefault()
      toggleZoom(e)
      lastTapRef.current = 0
      return
    }
    lastTapRef.current = now
  }

  function handleMediaMouseDown(e: React.MouseEvent<HTMLElement>) {
    if (zoomScale <= 1) return
    e.stopPropagation()
    e.preventDefault()
    panGestureRef.current = { point: { x: e.clientX, y: e.clientY }, pan: panRef.current, moved: false }
  }

  function handleMediaMouseMove(e: React.MouseEvent<HTMLElement>) {
    if (!panGestureRef.current || zoomScale <= 1) return
    e.stopPropagation()
    e.preventDefault()
    if (Math.hypot(e.clientX - panGestureRef.current.point.x, e.clientY - panGestureRef.current.point.y) > 6) {
      panGestureRef.current.moved = true
    }
    setZoomPanValue({
      x: panGestureRef.current.pan.x + e.clientX - panGestureRef.current.point.x,
      y: panGestureRef.current.pan.y + e.clientY - panGestureRef.current.point.y,
    })
  }

  function handleMediaMouseUp(e: React.MouseEvent<HTMLElement>) {
    if (!panGestureRef.current) return
    e.stopPropagation()
    panGestureRef.current = null
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
          caption: settingsCaption.trim() || null,
          author_name: settingsAuthor.trim() || null,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        display_radius?: number | null
        display_filter?: MediaDisplayFilter | null
        caption?: string | null
        author_name?: string | null
      }
      if (!res.ok) {
        setSettingsError(body.error ?? `Save failed (${res.status})`)
        showAppToast(body.error ?? `Save failed (${res.status})`, 'error')
        return
      }
      onPhotoUpdated(settingsPhoto.id, {
        display_radius: body.display_radius ?? null,
        display_filter: body.display_filter ?? null,
        caption: body.caption ?? null,
        author_name: body.author_name ?? null,
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

  function removeFromSlideshow(photoId: string) {
    if (!slideshowPhotoIds) return
    const newIds = slideshowPhotoIds.filter((id) => id !== photoId)
    if (newIds.length === 0) {
      setSlideshowPhotoIds(null)
      setLightbox(null)
      return
    }
    if (lightbox !== null && lightbox >= newIds.length) {
      setLightbox(newIds.length - 1)
    }
    setSlideshowPhotoIds(newIds)
    showAppToast('Removed from slideshow.')
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
    // For Stream-backed videos prefer the R2 mirror URL (the original mp4) over the iframe URL,
    // which isn't directly downloadable. If the mirror hasn't been written yet (background job
    // still pending, or migration not applied) we show the "not downloadable yet" toast so the
    // user knows the recording will become downloadable later.
    let sourceUrl = photo.url
    if (photo.storage_backend === 'stream') {
      if (photo.mirror_url) {
        sourceUrl = photo.mirror_url
      } else {
        showAppToast('This video is still being prepared for download. Try again in a minute.', 'error')
        return
      }
    }
    const urlExt = sourceUrl.split('?')[0].split('.').pop()?.toLowerCase()
    const ext = urlExt && urlExt.length <= 5 ? urlExt : (photo.media_type === 'video' ? 'mp4' : 'jpg')
    let baseName = photo.caption?.trim()
    if (!baseName) {
      const dateStr = photo.created_at
        ? new Date(photo.created_at).toISOString().slice(0, 10)
        : null
      baseName = dateStr
        ? `${photo.media_type === 'video' ? 'video' : 'photo'}_${dateStr}`
        : (photo.media_type === 'video' ? 'video' : 'photo')
    }
    const filename = `${baseName}.${ext}`
    const a = document.createElement('a')
    a.href = `/api/download/photo?url=${encodeURIComponent(sourceUrl)}&name=${encodeURIComponent(filename)}`
    a.download = filename
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

  async function savePhotoOrder(nextPhotos: Photo[]) {
    if (!ownerToken) return
    const previousPhotos = photos
    onPhotosReordered(nextPhotos)
    setReorderSaving(true)

    try {
      const res = await fetch('/api/album/photos/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, owner_token: ownerToken, photo_ids: nextPhotos.map((photo) => photo.id) }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        onPhotosReordered(previousPhotos)
        showAppToast(body.error ?? `Could not save order (${res.status})`, 'error')
      } else {
        showAppToast('Media order saved.')
      }
    } catch (e) {
      onPhotosReordered(previousPhotos)
      showAppToast(e instanceof Error ? e.message : 'Could not save order', 'error')
    } finally {
      setReorderSaving(false)
    }
  }

  function movePhoto(dragId: string, targetId: string) {
    if (dragId === targetId) return
    const fromIndex = photos.findIndex((photo) => photo.id === dragId)
    const toIndex = photos.findIndex((photo) => photo.id === targetId)
    if (fromIndex < 0 || toIndex < 0) return
    const nextPhotos = [...photos]
    ;[nextPhotos[fromIndex], nextPhotos[toIndex]] = [nextPhotos[toIndex], nextPhotos[fromIndex]]
    // Accumulate swaps locally — the save fires once when the user clicks Done (arrangeMode → false).
    const ordered = nextPhotos.map((photo, index) => ({ ...photo, sort_order: index }))
    pendingOrderRef.current = ordered
    const y = window.scrollY
    onPhotosReordered(ordered)
    requestAnimationFrame(() => {
      document.documentElement.style.scrollBehavior = 'auto'
      window.scrollTo(0, y)
      requestAnimationFrame(() => { document.documentElement.style.scrollBehavior = '' })
    })
  }

  function startReorderPress(photo: Photo, e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !isOwner || !ownerToken || reorderSaving) return
    if (arrangeMode) {
      // Only the drag handle (data-drag-handle) initiates a drag. Detecting it here on the
      // tile (rather than a separate onPointerDown on the handle) means setPointerCapture is
      // called on e.currentTarget — the tile — which is exactly what onPointerMove/Up expect.
      // stopPropagation on the handle itself would prevent this from firing at all.
      if (!(e.target as HTMLElement).closest('[data-drag-handle]')) return
      e.preventDefault()
      clearReorderTimer()
      const tileEl = e.currentTarget
      const rect = tileEl.getBoundingClientRect()
      reorderDragIdRef.current = photo.id
      reorderTargetIdRef.current = photo.id
      reorderDragPointerRef.current = { x: e.clientX, y: e.clientY }
      reorderDragTileSizeRef.current = Math.round(Math.min(rect.width, rect.height) * 0.82)
      try { if (tileEl.isConnected) tileEl.setPointerCapture(e.pointerId) } catch {}
      isArrangeDragRef.current = true
      reorderSuppressedClickRef.current = true
      window.setTimeout(() => { reorderSuppressedClickRef.current = false }, SUPPRESS_CLICK_AFTER_REORDER_MS)
      setReorderDraggingId(photo.id)
      setReorderTargetId(photo.id)
      setDragGhostPointer({ x: e.clientX, y: e.clientY })
      return
    }
    if (e.pointerType === 'touch') return
    const coarsePointer = typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches
    if (coarsePointer) return
    // Desktop only: 500ms hold enters select mode
    clearReorderTimer()
    reorderDragIdRef.current = photo.id
    reorderDragPointerRef.current = { x: e.clientX, y: e.clientY }
    const rect = e.currentTarget.getBoundingClientRect()
    reorderDragTileSizeRef.current = Math.round(Math.min(rect.width, rect.height) * 0.82)
    reorderTimerRef.current = window.setTimeout(() => {
      reorderTimerRef.current = null
      reorderSuppressedClickRef.current = true
      window.setTimeout(() => { reorderSuppressedClickRef.current = false }, SUPPRESS_CLICK_AFTER_REORDER_MS)
      setSelectMode(true)
      setSelectedIds(new Set([photo.id]))
    }, HOLD_TO_SELECT_MS)
  }

  // Mobile long-press → enter bulk-select. Uses native touch events because Android Chrome's
  // pointer events are flaky for hold detection. Skips arrange mode (pointer-event drag handles
  // that with setPointerCapture).
  const longPressScrollYRef = useRef(0)
  function handleTilePointerTouchStart(photo: Photo, e: React.TouchEvent<HTMLDivElement>) {
    if (!isOwner || !ownerToken || reorderSaving || arrangeMode) return
    if (e.touches.length !== 1) return
    const t = e.touches[0]
    longPressOriginRef.current = { x: t.clientX, y: t.clientY }
    longPressScrollYRef.current = window.scrollY
    clearReorderTimer()
    reorderTimerRef.current = window.setTimeout(() => {
      reorderTimerRef.current = null
      longPressOriginRef.current = null
      // Suppress the click and any subsequent contextmenu (Android Chrome fires it ~600 ms in)
      // for a window long enough to outlast the gesture.
      reorderSuppressedClickRef.current = true
      window.setTimeout(() => { reorderSuppressedClickRef.current = false }, SUPPRESS_CLICK_AFTER_SELECT_MS)
      setSelectMode(true)
      setSelectedIds(new Set([photo.id]))
    }, HOLD_TO_SELECT_MOBILE_MS)
  }

  function handleTileTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    if (!longPressOriginRef.current || reorderTimerRef.current == null) return
    // Page-scroll check with a 25 px tolerance — mobile browsers shift scrollY by ~10 px when
    // the address bar shows/hides, which is unrelated to the user dragging. Real scroll gestures
    // move the page much further than that within the first frame.
    if (Math.abs(window.scrollY - longPressScrollYRef.current) > 25) {
      clearReorderTimer()
      longPressOriginRef.current = null
      return
    }
    const t = e.touches[0]
    if (!t) return
    const dx = Math.abs(t.clientX - longPressOriginRef.current.x)
    const dy = Math.abs(t.clientY - longPressOriginRef.current.y)
    // 12 px lets a finger settle without canceling, while still catching any real swipe.
    if (dx > 12 || dy > 12) {
      clearReorderTimer()
      longPressOriginRef.current = null
    }
  }

  function handleTileTouchEnd() {
    // Short tap — cancel the pending long-press timer. If the timer already fired, this is a
    // no-op (reorderTimerRef.current is null) and select mode stays.
    if (reorderTimerRef.current != null) {
      clearReorderTimer()
      longPressOriginRef.current = null
    }
  }

  function handleReorderMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!isArrangeDragRef.current) return
    e.preventDefault()
    reorderDragPointerRef.current = { x: e.clientX, y: e.clientY }
    setDragGhostPointer({ x: e.clientX, y: e.clientY })
    updateAutoScroll(e.clientY)
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-photo-id]')
    const targetId = target?.dataset.photoId
    if (targetId) {
      reorderTargetIdRef.current = targetId
      setReorderTargetId(targetId)
    }
  }

  function finishReorder(e: React.PointerEvent<HTMLDivElement>) {
    clearReorderTimer()
    stopAutoScroll()
    const wasArrangeDrag = isArrangeDragRef.current
    const dragId = reorderDragIdRef.current
    const targetId = reorderTargetIdRef.current
    isArrangeDragRef.current = false
    reorderDragIdRef.current = null
    reorderTargetIdRef.current = null
    reorderDragPointerRef.current = null
    setReorderDraggingId(null)
    setReorderTargetId(null)
    setDragGhostPointer(null)
    if (wasArrangeDrag && dragId) {
      e.preventDefault()
      reorderSuppressedClickRef.current = true
      window.setTimeout(() => { reorderSuppressedClickRef.current = false }, 0)
      if (targetId) movePhoto(dragId, targetId)
    }
  }

  function handleTileClick(index: number) {
    if (reorderSuppressedClickRef.current) {
      reorderSuppressedClickRef.current = false
      return
    }
    if (selectMode) {
      const clicked = photos[index]
      if (clicked) toggleSelection(clicked.id)
      return
    }
    const clicked = photos[index]
    if (clicked && flippedPhotoId === clicked.id) {
      setFlippedPhotoId(null)
      return
    }
    setFlippedPhotoId(null)
    setSlideshowActive(false)
    setSlideshowPaused(false)
    setSlideshowPhotoIds(null)
    openLightbox(index)
  }

  function mediaNameFor(photo: Photo): string {
    return photo.caption?.trim() || photo.author_name?.trim() || ''
  }

  function toggleGridCardBack(photo: Photo, e: React.MouseEvent<HTMLElement>) {
    e.preventDefault()
    e.stopPropagation()
    if (arrangeMode) return
    // If our touch long-press timer just fired (Android Chrome's native contextmenu fires
    // ~600 ms in on long-press), suppress this — otherwise the contextmenu handler would
    // toggle the photo we just selected back off.
    if (reorderSuppressedClickRef.current) return
    clearReorderTimer()
    reorderDragIdRef.current = null
    setReorderDraggingId(null)
    setReorderTargetId(null)
    const coarsePointer = typeof window !== 'undefined' && window.matchMedia('(hover: none), (pointer: coarse)').matches
    if (coarsePointer) {
      if (!isOwner) return
      if (selectMode) {
        toggleSelection(photo.id)
      } else {
        setSelectMode(true)
        setSelectedIds(new Set([photo.id]))
        reorderSuppressedClickRef.current = true
        window.setTimeout(() => { reorderSuppressedClickRef.current = false }, SUPPRESS_CLICK_AFTER_REORDER_MS)
      }
      return
    }
    const mediaName = mediaNameFor(photo)
    if (!mediaName) {
      showAppToast('No name is set for this media yet.', 'error')
      return
    }
    setFlippedPhotoId((id) => (id === photo.id ? null : photo.id))
  }

  function toggleSlideshowPick(photoId: string) {
    setSlideshowSelectedIds((currentIds) => {
      const nextIds = new Set(currentIds)
      if (nextIds.has(photoId)) nextIds.delete(photoId)
      else nextIds.add(photoId)
      return nextIds
    })
  }

  function createSlideshow() {
    const selectedIds = photos.map((photo) => photo.id).filter((id) => slideshowSelectedIds.has(id))
    if (selectedIds.length < 2) {
      showAppToast('Pick at least 2 photos or videos for a slideshow.', 'error')
      return
    }
    slideshowRemainingMsRef.current = slideshowIntervalMs
    setSlideshowPhotoIds(selectedIds)
    setSlideshowActive(selectedIds.length > 1)
    setSlideshowPaused(false)
    setSlideshowPickerOpen(false)
    setLightbox(0)
  }

  function toggleSlideshowPause() {
    setSlideshowPaused((paused) => {
      const nextPaused = !paused
      if (nextPaused && current?.media_type !== 'video') {
        const startedAt = slideshowTimerStartedAtRef.current
        const remaining = slideshowRemainingMsRef.current ?? slideshowIntervalMs
        const elapsed = startedAt > 0 ? Date.now() - startedAt : 0
        slideshowRemainingMsRef.current = Math.max(250, remaining - elapsed)
        clearSlideshowTimer()
      }
      if (current?.media_type === 'video' && lightboxVideoRef.current) {
        if (nextPaused) {
          lightboxVideoRef.current.pause()
        } else {
          void lightboxVideoRef.current.play().catch(() => {
            setSlideshowPaused(true)
          })
        }
      }
      return nextPaused
    })
  }

  const prev = useCallback(() => {
    setLightbox((cur) => (cur === null ? null : cur === 0 ? viewerPhotos.length - 1 : cur - 1))
  }, [viewerPhotos.length])

  const next = useCallback(() => {
    setLightbox((cur) => (cur === null ? null : cur === viewerPhotos.length - 1 ? 0 : cur + 1))
  }, [viewerPhotos.length])

  function handleSwipeStart(e: React.TouchEvent<HTMLDivElement>) {
    if (zoomScale > 1 || e.touches.length !== 1) {
      swipeRef.current = null
      return
    }
    if (e.touches.length !== 1) return
    const touch = e.touches[0]
    swipeRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() }
    setSwipeAnimating(false)
    setSwipeOffset(0)
  }

  function handleSwipeMove(e: React.TouchEvent<HTMLDivElement>) {
    if (zoomScale > 1 || e.touches.length !== 1) return
    const start = swipeRef.current
    if (!start || e.touches.length !== 1) return

    const touch = e.touches[0]
    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (Math.abs(deltaX) < 8 || Math.abs(deltaX) < Math.abs(deltaY)) return

    setSwipeOffset(deltaX)
  }

  function handleSwipeEnd(e: React.TouchEvent<HTMLDivElement>) {
    if (zoomScale > 1) {
      swipeRef.current = null
      setSwipeOffset(0)
      return
    }
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
    const isHorizontalSwipe = Math.abs(deltaX) >= SWIPE_THRESHOLD_PX && Math.abs(deltaX) > Math.abs(deltaY) * 1.15
    if (!isHorizontalSwipe && velocity < SWIPE_VELOCITY_MIN) {
      setSwipeAnimating(true)
      setSwipeOffset(0)
      window.setTimeout(() => setSwipeAnimating(false), SWIPE_RESET_ANIMATE_MS)
      return
    }

    const direction = deltaX < 0 ? -1 : 1
    // Prevent iOS from synthesizing a click after the swipe, which would
    // call closeLightbox() via the swipe div's onClick handler.
    if (e.cancelable) e.preventDefault()
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

  useEffect(() => () => {
    clearReorderTimer()
    if (rotateTimerRef.current != null) window.clearTimeout(rotateTimerRef.current)
  }, [])

  useEffect(() => {
    if (arrangeMode && selectMode) exitSelectMode()
  }, [arrangeMode, selectMode])

  useEffect(() => {
    if (!selectMode) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); exitSelectMode() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectMode])

  useEffect(() => {
    if (!slideshowRequestId || !isOwner || handledSlideshowRequestRef.current === slideshowRequestId) return
    handledSlideshowRequestRef.current = slideshowRequestId
    if (photos.length === 0) {
      showAppToast('Upload media before creating a slideshow.', 'error')
      return
    }
    if (photos.length < 2) {
      showAppToast('A slideshow needs at least 2 photos or videos.', 'error')
      return
    }
    setSlideshowSelectedIds(new Set(photos.map((photo) => photo.id)))
    setSlideshowPickerOpen(true)
  }, [isOwner, photos, slideshowRequestId])

  useEffect(() => {
    if (!arrangeMode) { setShowArrangeHint(false); return }
    if (typeof window === 'undefined') return
    if (localStorage.getItem(ARRANGE_HINT_KEY)) return
    localStorage.setItem(ARRANGE_HINT_KEY, '1')
    setShowArrangeHint(true)
  }, [arrangeMode])

  useEffect(() => {
    const wasArranging = prevArrangeModeRef.current
    prevArrangeModeRef.current = arrangeMode
    // arrange mode just turned off AND there are unsaved swaps — fire a single save
    if (wasArranging && !arrangeMode && pendingOrderRef.current) {
      void savePhotoOrder(pendingOrderRef.current)
      pendingOrderRef.current = null
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrangeMode])

  useEffect(() => {
    setFlippedPhotoId(null)
  }, [current?.id])

  useEffect(() => {
    if (lightbox === null || current) return
    setLightbox(null)
    setSlideshowActive(false)
    setSlideshowPaused(false)
    setSlideshowPhotoIds(null)
  }, [current, lightbox])

  useEffect(() => {
    if (!overlayOpen) return

    function preventPageScroll(event: Event) {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-scroll-allowed="true"]')) return
      event.preventDefault()
    }

    document.documentElement.classList.add('hush-scroll-locked')
    document.body.classList.add('hush-scroll-locked')
    window.addEventListener('wheel', preventPageScroll, { passive: false })
    window.addEventListener('touchmove', preventPageScroll, { passive: false })

    return () => {
      window.removeEventListener('wheel', preventPageScroll)
      window.removeEventListener('touchmove', preventPageScroll)
      document.documentElement.classList.remove('hush-scroll-locked')
      document.body.classList.remove('hush-scroll-locked')
    }
  }, [overlayOpen])

  useEffect(() => {
    slideshowRemainingMsRef.current = slideshowIntervalMs
  }, [current?.id, slideshowIntervalMs])

  useEffect(() => {
    clearSlideshowTimer()
    if (!slideshowActive || slideshowPaused || lightbox === null || viewerPhotos.length < 2 || current?.media_type === 'video') {
      if (!slideshowPaused) slideshowRemainingMsRef.current = slideshowIntervalMs
      return
    }

    const duration = Math.max(250, Math.min(slideshowIntervalMs, slideshowRemainingMsRef.current ?? slideshowIntervalMs))
    slideshowRemainingMsRef.current = duration
    slideshowTimerStartedAtRef.current = Date.now()
    slideshowTimerRef.current = window.setTimeout(() => {
      slideshowRemainingMsRef.current = slideshowIntervalMs
      next()
    }, duration)

    return clearSlideshowTimer
  }, [slideshowActive, slideshowPaused, lightbox, viewerPhotos.length, current?.id, current?.media_type, next, slideshowIntervalMs, clearSlideshowTimer])

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

    // Pre-warm thumbnails before they enter the viewport. Now that grid images are small
    // thumbnails, a larger margin helps fast up/down scrolling without hammering the network.
    const preloadObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const imgEl = entry.target.querySelector<HTMLImageElement>('img')
          if (imgEl?.src) {
            const loader = new window.Image()
            loader.src = imgEl.src
          }
          preloadObserver.unobserve(entry.target)
        }
      },
      { rootMargin: `${GRID_PRELOAD_MARGIN_PX}px` },
    )
    grid.querySelectorAll<HTMLElement>('[data-photo-id]').forEach((tile) => preloadObserver.observe(tile))

    return () => {
      observer.disconnect()
      preloadObserver.disconnect()
      window.removeEventListener('resize', measureTiles)
    }
    // Depend on the set of photo IDs, NOT the full photos array reference. A photo UPDATE
    // (e.g. caption change, poster_url attach, realtime row update) produces a new photos
    // array but the same ID set — without this we'd tear down + rebuild both observers and
    // re-fire preload fetches for every tile every time, which is the main source of perceived
    // lag when an album has many items.
  }, [photoIdsKey, onRadiusMaxChange])

  useEffect(() => {
    setLightboxMediaNode(null)
    setLightboxRadiusMax(null)
    resetZoom()
    setLightboxFlipped(false)
    setSwipeAnimating(false)
    setSwipeOffset(0)
    lastTapRef.current = 0
  }, [current?.id, resetZoom])

  // Prefetch the current original + ±2 neighbors as soon as the lightbox index changes. The
  // browser image cache means the visible <img> (and every subsequent swipe) paints from cache
  // instead of starting a fresh multi-MB download. Skip videos — their players manage their own
  // buffering and originals are huge. The state flip flag is set once the prefetch onload fires
  // so the visible <img> can swap from the cached thumb to the full original.
  useEffect(() => {
    if (lightbox === null) return
    if (typeof window === 'undefined') return
    const viewer = viewerPhotosRef.current
    for (const delta of [0, 1, -1, 2, -2]) {
      const i = lightbox + delta
      if (i < 0 || i >= viewer.length) continue
      const photo = viewer[i]
      if (!photo || photo.media_type === 'video' || !photo.url) continue
      const loader = new window.Image()
      // Cast: fetchPriority is widely supported but not in all DOM lib versions.
      ;(loader as HTMLImageElement & { fetchPriority?: string }).fetchPriority = delta === 0 ? 'high' : 'low'
      loader.onload = () => {
        setLightboxOriginalLoadedIds((prev) => {
          if (prev.has(photo.id)) return prev
          const next = new Set(prev)
          next.add(photo.id)
          return next
        })
      }
      loader.src = photo.url
    }
  }, [lightbox])

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
    const max = current?.id === settingsPhoto.id && lightboxRadiusMax != null
      ? lightboxRadiusMax
      : Math.max(1, Math.round(tileRadiusMaxById[settingsPhoto.id] ?? 144))
    if (settingsRadius > max) setSettingsRadius(max)
  }, [current, lightboxRadiusMax, settingsPhoto, settingsRadius, tileRadiusMaxById])

  // Ref-backed handler bag. Each render assigns the LATEST handlers into the ref, so the
  // memoized tile JSX (below) can dispatch to them without stale-closure issues. This pattern
  // gives us identity-stable callbacks for the useMemo without paying the cost of useCallback
  // dependency lists across ~10 handlers.
  // NOTE: hooks must come before any early return — that's why this is positioned above the
  // empty-state branch even though it isn't used until later.
  const tileHandlersRef = useRef({
    handleTileClick, startReorderPress, handleReorderMove, finishReorder,
    handleTilePointerTouchStart, handleTileTouchMove, handleTileTouchEnd,
    clearReorderTimer, toggleGridCardBack, setPosterBroken, markBroken,
    reorderDraggingActive: reorderDraggingId != null,
  })
  tileHandlersRef.current = {
    handleTileClick, startReorderPress, handleReorderMove, finishReorder,
    handleTilePointerTouchStart, handleTileTouchMove, handleTileTouchEnd,
    clearReorderTimer, toggleGridCardBack, setPosterBroken, markBroken,
    reorderDraggingActive: reorderDraggingId != null,
  }

  // Memoize the tile JSX array. When the parent re-renders for an UNrelated reason
  // (lightbox open/close, slideshow timer tick, zoom state change, etc.), this returns the
  // same array reference and React skips reconciliation of all tiles — making the lightbox
  // open/close feel instant on 200-400 photo albums.
  const tiles = useMemo(() => photos.map((photo, index) => {
          const isVideo = photo.media_type === 'video'
          // For videos, drop the poster src entirely if the poster failed to load so the tile
          // shows the placeholder + Play icon instead of a broken-image icon under the overlay.
          const thumbSrc = isVideo
            ? (posterBroken.has(photo.id) ? '' : (photo.stream_thumbnail_url || photo.poster_url || ''))
            : (photo.thumb_url || photo.url)
          const isBroken = broken.has(photo.id)
          const mediaRadius = previewRadiusFor(photo)
          const filter = cssMediaDisplayFilter(previewFilterFor(photo))
          const mediaName = mediaNameFor(photo)
          const isGridFlipped = Boolean(mediaName && flippedPhotoId === photo.id)
          const isReorderMode = arrangeMode || reorderDraggingId != null
          const isReorderDragging = reorderDraggingId === photo.id
          const isReorderTarget = reorderDraggingId != null && reorderTargetId === photo.id && reorderDraggingId !== photo.id
          return (
            <div key={photo.id}>
              <div
                className={`${isReorderMode ? 'hush-reorder-ring ' : ''}${isReorderDragging || isReorderTarget ? 'hush-reorder-ring-solid ' : ''}hush-photo-tile relative aspect-square overflow-hidden cursor-pointer`}
                data-photo-id={photo.id}
                style={{
                  background: '#EDE7DB',
                  borderRadius: mediaRadius,
                  opacity: isReorderDragging ? 0.58 : 1,
                  // Block touch-based scrolling ONLY while a drag is in flight.
                  // Keeping 'none' for the whole arrange session blocked page scroll on mobile,
                  // making it impossible to reach photos below the fold before dragging.
                  // Once a drag starts (reorderDraggingId set + setPointerCapture called),
                  // the captured pointer ignores touchAction anyway.
                  touchAction: !!reorderDraggingId ? 'none' : 'manipulation',
                  WebkitTouchCallout: 'none',
                  userSelect: 'none',
                }}
                onClick={() => tileHandlersRef.current.handleTileClick(index)}
                onPointerDown={(e) => tileHandlersRef.current.startReorderPress(photo, e)}
                onPointerMove={(e) => tileHandlersRef.current.handleReorderMove(e)}
                onPointerUp={(e) => tileHandlersRef.current.finishReorder(e)}
                onPointerCancel={(e) => tileHandlersRef.current.finishReorder(e)}
                onPointerLeave={(e) => {
                  if (tileHandlersRef.current.reorderDraggingActive) {
                    tileHandlersRef.current.handleReorderMove(e)
                    return
                  }
                  tileHandlersRef.current.clearReorderTimer()
                }}
                onTouchStart={(e) => tileHandlersRef.current.handleTilePointerTouchStart(photo, e)}
                onTouchMove={(e) => tileHandlersRef.current.handleTileTouchMove(e)}
                onTouchEnd={() => tileHandlersRef.current.handleTileTouchEnd()}
                onContextMenu={(e) => tileHandlersRef.current.toggleGridCardBack(photo, e)}
                onDragStart={(e) => e.preventDefault()}
              >
                {thumbSrc && !isBroken ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumbSrc}
                    alt={photo.caption || ''}
                    loading="lazy"
                    decoding="async"
                    // Grid thumbnails are background work — let the browser deprioritise these
                    // in favour of the currently-visible lightbox image and any active uploads.
                    draggable={false}
                    className={mediaImageClass()}
                    style={{
                      position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
                      '--hush-media-filter': filter,
                    } as React.CSSProperties}
                    onError={() => {
                      if (isVideo) {
                        // Poster failed but the video itself may still play — flag the poster
                        // only, not the whole photo, so the lightbox can still open the video.
                        tileHandlersRef.current.setPosterBroken((prev) => {
                          if (prev.has(photo.id)) return prev
                          const next = new Set(prev)
                          next.add(photo.id)
                          return next
                        })
                      } else {
                        tileHandlersRef.current.markBroken(photo.id)
                      }
                    }}
                    onContextMenu={(e) => tileHandlersRef.current.toggleGridCardBack(photo, e)}
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 px-3 text-center" style={{ background: '#E8E0D2' }}>
                    {isVideo ? <Play className="w-8 h-8" style={{ color: '#7C5C3E' }} /> : null}
                    {/*
                      Text rules:
                      - Video + actually broken media URL → "Video unavailable"
                      - Video + only missing/broken poster (media URL still works) → no text, just Play
                      - Image → same as before: "File unavailable" if broken, "Preview unavailable" otherwise
                    */}
                    {isVideo ? (
                      isBroken ? (
                        <span className="text-xs font-semibold" style={{ color: '#7C5C3E' }}>Video unavailable</span>
                      ) : null
                    ) : (
                      <span className="text-xs font-semibold" style={{ color: '#7C5C3E' }}>
                        {isBroken ? 'File unavailable' : 'Preview unavailable'}
                      </span>
                    )}
                  </div>
                )}

                {isVideo && (
                  <>
                    <span
                      className="absolute inset-0 flex items-center justify-center pointer-events-none"
                    >
                      <span
                        className="rounded-full flex items-center justify-center"
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

                {isGridFlipped && (
                  <div className="hush-grid-photo-back" style={{ borderRadius: mediaRadius }}>
                    <strong className="hush-photo-back-title">{mediaName}</strong>
                  </div>
                )}
                {isOwner && selectMode && (
                  <div
                    className="absolute inset-0 pointer-events-none z-10"
                    style={{ background: selectedIds.has(photo.id) ? 'rgba(37,79,34,0.28)' : 'transparent' }}
                  >
                    <span
                      className="absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center"
                      style={{
                        background: selectedIds.has(photo.id) ? '#254F22' : 'rgba(253,250,245,0.88)',
                        border: `2px solid ${selectedIds.has(photo.id) ? '#254F22' : 'rgba(37,79,34,0.40)'}`,
                      }}
                    >
                      {selectedIds.has(photo.id) && <Check className="w-3.5 h-3.5" style={{ color: '#FDFAF5' }} />}
                    </span>
                  </div>
                )}
                {arrangeMode && (
                  <div
                    className="absolute top-1.5 left-1.5 z-20 flex items-center justify-center rounded-md w-7 h-7 md:w-9 md:h-9"
                    data-drag-handle="true"
                    style={{
                      touchAction: 'none',
                      background: 'rgba(37,79,34,0.78)',
                      backdropFilter: 'blur(4px)',
                      WebkitBackdropFilter: 'blur(4px)',
                      cursor: reorderDraggingId === photo.id ? 'grabbing' : 'grab',
                    }}
                  >
                    <Move className="w-4 h-4 md:w-5 md:h-5" style={{ color: '#FDFAF5', pointerEvents: 'none' }} />
                  </div>
                )}
              </div>
            </div>
          )
        // Tile JSX deps — everything its rendering reads, EXCLUDING lightbox/slideshow/zoom
        // state. That exclusion is the point: open/close lightbox → these deps unchanged →
        // useMemo returns the same array → React skips re-rendering the tiles.
        //
        // previewRadiusFor and previewFilterFor are inline functions inside this component;
        // they internally read settingsPhoto/settingsRadius/settingsFilter (already in deps).
        // Intentionally NOT included: lightbox, slideshowActive, slideshowPaused, current,
        // zoomScale, zoomPan, swipeOffset, lightboxFlipped, deleting, etc. Those are light-
        // box concerns; tiles don't depend on them.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        }), [
          photos,
          album.media_hover, album.mobile_grid_columns,
          forceGlobalRadius,
          tileRadiusMaxById,
          settingsPhoto, settingsRadius, settingsFilter,
          arrangeMode, reorderDraggingId, reorderTargetId,
          flippedPhotoId,
          broken, posterBroken,
          isOwner, selectMode, selectedIds,
        ])

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
      {showArrangeHint && (
        <div
          className="flex items-center gap-3 rounded-2xl px-4 py-3 mb-4"
          style={{ background: '#254F22' }}
        >
          {/* Mini replica of the tile handle so users can visually match it */}
          <span
            className="shrink-0 flex items-center justify-center rounded-lg"
            style={{ width: 28, height: 28, background: 'rgba(255,255,255,0.18)' }}
          >
            <Move className="w-3.5 h-3.5" style={{ color: '#FDFAF5', pointerEvents: 'none' }} />
          </span>
          <p className="flex-1 text-sm leading-snug" style={{ color: '#FDFAF5' }}>
            Tap this handle on any photo, then drag it onto another to swap.
          </p>
          <button
            type="button"
            aria-label="Dismiss arrange tip"
            className="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
            onClick={() => setShowArrangeHint(false)}
          >
            <X className="w-4 h-4" style={{ color: '#FDFAF5' }} />
          </button>
        </div>
      )}
      <div
        ref={gridRef}
        className="hush-photo-grid grid gap-3 xl:gap-4"
        style={{ '--hush-grid-cols': album.mobile_grid_columns ?? 3 } as React.CSSProperties}
      >
        {tiles}
      </div>

      {current && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden${slideshowMode ? ' hush-slideshow-overlay' : ''}`} onClick={closeLightbox} onWheel={(e) => { if (!(e.target as HTMLElement).closest('[data-scroll-allowed="true"]')) e.preventDefault() }}>
          <div aria-hidden className="absolute inset-0" style={{ background: 'rgba(5, 8, 5, 0.92)' }} />

          <button
            type="button"
            aria-label="Close"
            className="absolute top-4 right-4 z-20 flex items-center justify-center rounded-full transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
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
          {!slideshowMode && (
            <>
              <button
                className="absolute left-3 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center rounded-full transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                style={{
                  width: 40, height: 40,
                  background: 'rgba(15,20,15,0.62)',
                  border: '1px solid rgba(253,250,245,0.30)',
                  color: '#FDFAF5',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                }}
                onClick={(e) => { e.stopPropagation(); prev() }}
                aria-label="Previous photo"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center rounded-full transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                style={{
                  width: 40, height: 40,
                  background: 'rgba(15,20,15,0.62)',
                  border: '1px solid rgba(253,250,245,0.30)',
                  color: '#FDFAF5',
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                }}
                onClick={(e) => { e.stopPropagation(); next() }}
                aria-label="Next photo"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </>
          )}

          <div
            className={`hush-modal-pop relative z-10 max-w-[min(96vw,1100px)] max-h-[80vh] mx-4 sm:mx-16 flex flex-col items-center gap-4${slideshowMode ? ' hush-slideshow-stage' : ''}`}
            style={{
              touchAction: 'pan-y',
              transform: `translateX(${swipeOffset}px) scale(${Math.max(0.94, 1 - Math.min(Math.abs(swipeOffset), 180) / 1800)})`,
              transition: swipeAnimating ? 'transform 150ms ease-out' : 'none',
            }}
            onClick={(e) => { e.stopPropagation(); closeLightbox() }}
            onTouchStart={handleSwipeStart}
            onTouchMove={handleSwipeMove}
            onTouchEnd={handleSwipeEnd}
            onTouchCancel={() => {
              swipeRef.current = null
              setSwipeAnimating(true)
              setSwipeOffset(0)
              window.setTimeout(() => setSwipeAnimating(false), SWIPE_RESET_ANIMATE_MS)
            }}
          >
            {slideshowMode && (
              <div className="hush-slideshow-head" onClick={(e) => e.stopPropagation()}>
                <span>Slideshow</span>
                <strong>{(lightbox ?? 0) + 1} / {viewerPhotos.length}</strong>
              </div>
            )}

            {(!current.url && !current.stream_uid) || broken.has(current.id) ? (
              // Same fallback for missing URL (legacy rows where url is null/empty) and for
              // media that failed to load. <video src=""> doesn't reliably fire an error event,
              // so we have to guard explicitly here instead of relying only on onError.
              <div className="flex min-h-[240px] w-[min(92vw,720px)] flex-col items-center justify-center px-6 text-center" style={{ background: 'rgba(253,250,245,0.94)', borderRadius: previewRadiusFor(current) }} onClick={(e) => e.stopPropagation()}>
                <p className="font-semibold" style={{ color: '#254F22' }}>This file is unavailable</p>
                <p className="mt-2 text-sm" style={{ color: '#7C5C3E' }}>The album row still exists, but the storage object could not be loaded.</p>
              </div>
            ) : current.media_type === 'video' && current.stream_uid ? (
              <div className={`hush-photo-flip relative w-[min(92vw,1100px)]${slideshowFrameClass}`} key={current.id} onContextMenu={(e) => e.preventDefault()}>
                <iframe
                  src={streamFrameSrc(current, slideshowMode ? !slideshowPaused : !!album.video_autoplay)}
                  allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture;"
                  allowFullScreen
                  className="block aspect-video max-h-[min(65vh,680px)] w-[min(92vw,1100px)] max-w-full"
                  style={{ background: '#000', border: 0, borderRadius: previewRadiusFor(current) }}
                  onClick={(e) => e.stopPropagation()}
                  onLoad={(e) => {
                    setLightboxMediaNode(e.currentTarget)
                  }}
                />
              </div>
            ) : current.media_type === 'video' ? (
              <div className={`hush-photo-flip relative w-[min(92vw,1100px)]${slideshowFrameClass}`} key={current.id} onContextMenu={(e) => e.preventDefault()}>
                <video
                  src={current.url}
                  poster={current.poster_url || undefined}
                  controls
                  autoPlay={slideshowMode ? !slideshowPaused : !!album.video_autoplay}
                  muted={slideshowMode}
                  playsInline
                  className="block max-h-[min(65vh,680px)] max-w-full object-contain"
                  ref={(node) => {
                    lightboxVideoRef.current = node
                    setLightboxMediaNode(node)
                  }}
                  style={{ background: '#000', ...mediaZoomStyle(current) }}
                  onClick={(e) => e.stopPropagation()}
                  onEnded={() => {
                    if (slideshowActive && !slideshowPaused && viewerPhotos.length > 1) next()
                  }}
                  // Without this, a broken video URL or unsupported codec leaves the lightbox
                  // showing a black box with controls and no error — looks like "not opening".
                  // Marking the photo broken triggers the same "File unavailable" fallback the
                  // image branch already had.
                  onError={() => markBroken(current.id)}
                  onDoubleClick={(e) => { e.stopPropagation(); toggleZoom(e) }}
                  onMouseDown={handleMediaMouseDown}
                  onMouseMove={handleMediaMouseMove}
                  onMouseUp={handleMediaMouseUp}
                  onMouseLeave={handleMediaMouseUp}
                  onTouchStart={handleMediaTouchStart}
                  onTouchMove={handleMediaTouchMove}
                  onTouchEnd={handleMediaTouchEnd}
                  onContextMenu={(e) => e.preventDefault()}
                />
                {lightboxFlipped && (
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center"
                    style={{ background: 'rgba(253,250,245,0.97)', borderRadius: previewRadiusFor(current), backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
                    onClick={(e) => { e.stopPropagation(); setLightboxFlipped(false) }}
                  >
                    {current.caption && <p className="text-xl font-semibold text-center px-6 leading-snug" style={{ color: '#254F22' }}>{current.caption}</p>}
                    {current.author_name && <p className={`text-sm${current.caption ? ' mt-2' : ''}`} style={{ color: '#7C5C3E' }}>by {current.author_name}</p>}
                    {!current.caption && !current.author_name && <p className="text-sm" style={{ color: '#A89880' }}>No info set</p>}
                    <p className="mt-4 text-xs" style={{ color: '#C5B9A8' }}>Tap to close</p>
                  </div>
                )}
              </div>
            ) : (
              <div className={`hush-photo-flip relative w-[min(92vw,1100px)]${slideshowFrameClass}`} key={current.id} onContextMenu={(e) => e.preventDefault()}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={
                    current.thumb_url && !lightboxOriginalLoadedIds.has(current.id)
                      ? current.thumb_url
                      : current.url
                  }
                  alt={current.caption || ''}
                  className="block max-h-[min(70vh,760px)] max-w-full object-contain"
                  ref={(node) => setLightboxMediaNode(node)}
                  style={mediaZoomStyle(current)}
                  onLoad={(e) => {
                    // Mark loaded once the original (not the thumb) finishes painting. The src
                    // logic above falls back to thumb_url while the original is still being
                    // fetched — once the loaded set includes this photo's id, we keep showing
                    // the original.
                    if (e.currentTarget.src.endsWith(current.url) || !current.thumb_url) {
                      setLightboxOriginalLoadedIds((prev) => {
                        if (prev.has(current.id)) return prev
                        const next = new Set(prev)
                        next.add(current.id)
                        return next
                      })
                    }
                  }}
                  onError={() => {
                    // If the (cached-thumb) placeholder errored, swap to the original instead
                    // of marking the whole photo broken — the original is on a different path
                    // and may load fine. Only the original failing means the row is truly broken.
                    if (current.thumb_url && !lightboxOriginalLoadedIds.has(current.id)) {
                      setLightboxOriginalLoadedIds((prev) => {
                        if (prev.has(current.id)) return prev
                        const next = new Set(prev)
                        next.add(current.id)
                        return next
                      })
                      return
                    }
                    markBroken(current.id)
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => { e.stopPropagation(); toggleZoom(e) }}
                  onMouseDown={handleMediaMouseDown}
                  onMouseMove={handleMediaMouseMove}
                  onMouseUp={handleMediaMouseUp}
                  onMouseLeave={handleMediaMouseUp}
                  onTouchStart={handleMediaTouchStart}
                  onTouchMove={handleMediaTouchMove}
                  onTouchEnd={handleMediaTouchEnd}
                  onContextMenu={(e) => e.preventDefault()}
                  onDragStart={(e) => e.preventDefault()}
                />
                {lightboxFlipped && (
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center"
                    style={{ background: 'rgba(253,250,245,0.97)', borderRadius: previewRadiusFor(current), backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
                    onClick={(e) => { e.stopPropagation(); setLightboxFlipped(false) }}
                  >
                    {current.caption && <p className="text-xl font-semibold text-center px-6 leading-snug" style={{ color: '#254F22' }}>{current.caption}</p>}
                    {current.author_name && <p className={`text-sm${current.caption ? ' mt-2' : ''}`} style={{ color: '#7C5C3E' }}>by {current.author_name}</p>}
                    {!current.caption && !current.author_name && <p className="text-sm" style={{ color: '#A89880' }}>No info set</p>}
                    <p className="mt-4 text-xs" style={{ color: '#C5B9A8' }}>Tap to close</p>
                  </div>
                )}
              </div>
            )}

            {slideshowMode && (
              <div className="hush-slideshow-progress" aria-hidden>
                <span key={`${current.id}-${slideshowIntervalMs}`} className={slideshowPaused || current.media_type === 'video' ? 'is-paused' : ''} style={{ animationDuration: `${slideshowIntervalMs}ms` }} />
              </div>
            )}

            <div className={`flex items-center gap-4${slideshowMode ? ' hush-slideshow-controls' : ''}`} onClick={(e) => e.stopPropagation()}>
              {slideshowMode && viewerPhotos.length > 1 && (
                <button onClick={(e) => { e.stopPropagation(); toggleSlideshowPause() }} className="p-2 rounded-lg transition hover:opacity-80" style={{ background: slideshowPaused ? 'rgba(253,250,245,0.92)' : 'rgba(138,181,133,0.28)', color: slideshowPaused ? '#254F22' : '#FDFAF5', border: '1px solid rgba(253,250,245,0.28)' }} title={slideshowPaused ? 'Resume slideshow' : 'Pause slideshow'} aria-label={slideshowPaused ? 'Resume slideshow' : 'Pause slideshow'}>
                  {slideshowPaused ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
                </button>
              )}
              {!slideshowMode && (current.caption || current.author_name) && (
                <div className="text-center">
                  {current.caption && <p className="font-medium" style={{ color: '#FDFAF5' }}>{current.caption}</p>}
                  {current.author_name && <p className="text-sm" style={{ color: '#C5D9C2' }}>by {current.author_name}</p>}
                </div>
              )}

              {!slideshowMode && current.storage_backend !== 'stream' && (
                <button onClick={(e) => { e.stopPropagation(); downloadPhoto(current) }} disabled={broken.has(current.id)} className="p-2 rounded-lg transition hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: 'rgba(255,255,255,0.15)', color: '#FDFAF5' }} title="Download">
                  <Download className="w-5 h-5" />
                </button>
              )}
              {isOwner && !slideshowMode && (
                <button
                  onClick={(e) => { e.stopPropagation(); void setCoverPhoto(current) }}
                  disabled={settingCover}
                  title={coverPhotoId === current.id ? 'Clear album cover' : 'Set as album cover'}
                  className="p-2 rounded-lg transition hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: 'rgba(255,255,255,0.15)', color: coverPhotoId === current.id ? '#F4C430' : '#FDFAF5' }}
                >
                  <Star className="w-5 h-5" fill={coverPhotoId === current.id ? '#F4C430' : 'none'} />
                </button>
              )}
              {isOwner && (
                <>
                  {!slideshowMode && (
                    <button onClick={(e) => { e.stopPropagation(); openSettings(current) }} className="p-2 rounded-lg transition hover:opacity-80" style={{ background: 'rgba(255,255,255,0.15)', color: '#FDFAF5' }} title="Settings">
                      <Settings className="w-5 h-5" />
                    </button>
                  )}
                  {slideshowMode ? (
                    <button onClick={(e) => { e.stopPropagation(); removeFromSlideshow(current.id) }} className="p-2 rounded-lg transition hover:opacity-80" style={{ background: 'rgba(255,255,255,0.15)', color: '#FDFAF5' }} title="Remove from slideshow" aria-label="Remove from slideshow">
                      <X className="w-5 h-5" />
                    </button>
                  ) : (
                    <button onClick={(e) => { e.stopPropagation(); deletePhoto(current) }} disabled={deleting === current.id} className="p-2 rounded-lg transition hover:opacity-80 disabled:opacity-50" style={{ background: 'rgba(192,57,43,0.3)', color: '#FDFAF5' }} title="Delete photo" aria-label="Delete photo">
                      <Trash2 className="w-5 h-5" />
                    </button>
                  )}
                </>
              )}
            </div>

            {!slideshowMode && <p className="text-sm" style={{ color: '#8AB585' }}>{(lightbox ?? 0) + 1} / {viewerPhotos.length}</p>}

            {slideshowMode && viewerPhotos.length > 1 && (
              <div className="hush-slideshow-strip" data-scroll-allowed="true" onClick={(e) => e.stopPropagation()}>
                {viewerPhotos.map((photo, index) => {
                  const isActive = index === lightbox
                  const thumbSrc = photo.media_type === 'video' ? photo.stream_thumbnail_url || photo.poster_url || '' : (photo.thumb_url || photo.url)
                  return (
                    <button
                      key={photo.id}
                      type="button"
                      className={`hush-slideshow-thumb${isActive ? ' is-active' : ''}`}
                      onClick={() => { setLightbox(index); setSlideshowPaused(true) }}
                      aria-label={`Open slide ${index + 1}`}
                    >
                      {thumbSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbSrc} alt="" draggable={false} />
                      ) : (
                        <Play className="h-5 w-5" />
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {slideshowPickerOpen && isOwner && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-6" onClick={() => setSlideshowPickerOpen(false)}>
          <div aria-hidden className="absolute inset-0" style={{ background: 'rgba(12, 16, 12, 0.72)' }} />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="slideshow-picker-title"
            className="relative z-10 w-[min(94vw,860px)] rounded-2xl p-4 sm:p-5"
            style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', boxShadow: '0 24px 70px rgba(0,0,0,0.28)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 id="slideshow-picker-title" className="text-lg font-semibold" style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}>Create slideshow</h2>
                <p className="text-sm mt-1" style={{ color: '#7C5C3E' }}>
                  Pick the media you want to include. They will play in the current album order.
                </p>
              </div>
              <button type="button" className="rounded-full p-2 transition hover:opacity-80" style={{ background: '#F5F0E8', color: '#7C5C3E' }} onClick={() => setSlideshowPickerOpen(false)} aria-label="Close slideshow picker">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button type="button" className="rounded-full px-3 py-1.5 text-sm font-semibold transition hover:opacity-80" style={{ background: '#EAF0E8', color: '#254F22' }} onClick={() => setSlideshowSelectedIds(new Set(photos.map((photo) => photo.id)))}>
                Select all
              </button>
              <button type="button" className="rounded-full px-3 py-1.5 text-sm font-semibold transition hover:opacity-80" style={{ background: '#F5F0E8', color: '#7C5C3E' }} onClick={() => setSlideshowSelectedIds(new Set())}>
                Clear
              </button>
              <span className="text-sm" style={{ color: '#8B6F4E' }}>{slideshowSelectedIds.size} selected</span>
            </div>

            <div className="grid max-h-[52vh] grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 md:grid-cols-5" data-scroll-allowed="true">
              {photos.map((photo) => {
                const selected = slideshowSelectedIds.has(photo.id)
                const thumbSrc = photo.media_type === 'video' ? photo.stream_thumbnail_url || photo.poster_url || '' : (photo.thumb_url || photo.url)
                return (
                  <button
                    key={photo.id}
                    type="button"
                    className="relative aspect-square overflow-hidden rounded-xl transition"
                    style={{ border: selected ? '3px solid #254F22' : '1px solid #DDD5C5', background: '#E8E0D2' }}
                    onClick={() => toggleSlideshowPick(photo.id)}
                  >
                    {thumbSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbSrc} alt="" className="h-full w-full object-cover" draggable={false} />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center" style={{ color: '#7C5C3E' }}>
                        <Play className="h-7 w-7" />
                      </span>
                    )}
                    <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full" style={{ background: selected ? '#254F22' : 'rgba(253,250,245,0.82)', color: selected ? '#FDFAF5' : '#7C5C3E', border: '1px solid rgba(37,79,34,0.18)' }}>
                      {selected ? <Check className="h-4 w-4" /> : null}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="rounded-xl px-4 py-2 font-semibold transition hover:opacity-80" style={{ background: '#F5F0E8', color: '#7C5C3E' }} onClick={() => setSlideshowPickerOpen(false)}>
                Cancel
              </button>
              <button type="button" className="rounded-xl px-4 py-2 font-semibold transition hover:opacity-90" style={{ background: '#254F22', color: '#FDFAF5' }} onClick={createSlideshow}>
                Create slideshow
              </button>
            </div>
          </section>
        </div>
      )}

      {reorderDraggingId && dragGhostPointer && (() => {
        const ghost = photos.find((p) => p.id === reorderDraggingId)
        if (!ghost) return null
        const size = reorderDragTileSizeRef.current
        const thumbSrc = ghost.media_type === 'video' ? ghost.stream_thumbnail_url || ghost.poster_url || '' : (ghost.thumb_url || ghost.url)
        return (
          <div
            style={{
              position: 'fixed',
              left: dragGhostPointer.x - size / 2,
              top: dragGhostPointer.y - size / 2,
              width: size,
              height: size,
              zIndex: 300,
              pointerEvents: 'none',
              borderRadius: previewRadiusFor(ghost),
              overflow: 'hidden',
              transform: 'scale(1.1)',
              transformOrigin: 'center',
              boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
              border: '2px solid rgba(253,250,245,0.65)',
              opacity: 0.93,
            }}
          >
            {thumbSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} draggable={false} />
            ) : (
              <div style={{ width: '100%', height: '100%', background: '#E8E0D2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Play className="w-6 h-6" style={{ color: '#7C5C3E' }} />
              </div>
            )}
          </div>
        )
      })()}

      {isOwner && selectMode && (
        <div
          className="fixed bottom-0 left-0 right-0 z-[200] flex items-center justify-between gap-3 px-4 py-4 sm:px-6"
          style={{
            background: 'rgba(253,250,245,0.96)',
            borderTop: '1px solid #DDD5C5',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-sm font-semibold rounded-xl px-3 py-1.5 transition hover:opacity-80"
              style={{ background: '#EAF0E8', color: '#254F22' }}
              onClick={() => setSelectedIds(new Set(photos.map((p) => p.id)))}
            >
              All
            </button>
            <span className="text-sm font-medium" style={{ color: '#254F22' }}>
              {selectedIds.size} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-xl px-4 py-2 text-sm font-semibold transition hover:opacity-80"
              style={{ background: '#F5F0E8', color: '#7C5C3E' }}
              onClick={exitSelectMode}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedIds.size === 0 || bulkDeleting}
              className="rounded-xl px-4 py-2 text-sm font-semibold transition hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: selectedIds.size > 0 ? '#C0392B' : '#DDD5C5', color: '#FDFAF5' }}
              onClick={() => void bulkDeleteSelected()}
            >
              {bulkDeleting ? 'Deleting…' : `Delete ${selectedIds.size}`}
            </button>
          </div>
        </div>
      )}

      {settingsPhoto && isOwner && (
        <PhotoSettingsModal
          album={album}
          photo={settingsPhoto}
          radius={settingsRadius}
          filter={settingsFilter}
          caption={settingsCaption}
          author={settingsAuthor}
          saving={settingsSaving}
          error={settingsError}
          radiusMax={radiusMaxFor(settingsPhoto)}
          captionMax={MEDIA_CAPTION_MAX}
          authorMax={MEDIA_AUTHOR_MAX}
          onClose={() => setSettingsPhoto(null)}
          onRadiusChange={applySettingsRadius}
          onRadiusReset={() => setSettingsRadius(album.media_radius ?? 12)}
          onFilterChange={setSettingsFilter}
          onCaptionChange={setSettingsCaption}
          onAuthorChange={setSettingsAuthor}
          onSave={savePhotoSettings}
        />
      )}
    </>
  )
}

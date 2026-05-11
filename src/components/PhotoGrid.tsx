'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { type Album, type Photo } from '@/lib/supabase'
import { DEFAULT_SLIDESHOW_INTERVAL_MS, cssMediaDisplayFilter, type MediaDisplayFilter, type SlideshowAnimation } from '@/lib/media-display'
import { formatDuration } from '@/lib/media'
import { showAppToast } from '@/components/AppToast'
import PhotoSettingsModal, { type PhotoFilterChoice } from '@/components/photo-grid/PhotoSettingsModal'
import Image from 'next/image'
import { Download, Trash2, X, ChevronLeft, ChevronRight, Play, Pause, Check, Settings } from 'lucide-react'

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

export default function PhotoGrid({ album, photos, isOwner, slug, ownerToken, forceGlobalRadius, onRadiusMaxChange, onPhotoDeleted, onPhotoUpdated, onPhotosReordered, slideshowRequestId = 0 }: Props) {
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
  const reorderDragIdRef = useRef<string | null>(null)
  const reorderSuppressedClickRef = useRef(false)
  const lastTapRef = useRef(0)
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
  const [reorderDraggingId, setReorderDraggingId] = useState<string | null>(null)
  const [reorderTargetId, setReorderTargetId] = useState<string | null>(null)
  const [reorderSaving, setReorderSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [broken, setBroken] = useState<Set<string>>(new Set())
  const [tileRadiusMaxById, setTileRadiusMaxById] = useState<Record<string, number>>({})
  const [lightboxMediaNode, setLightboxMediaNode] = useState<HTMLElement | null>(null)
  const [lightboxRadiusMax, setLightboxRadiusMax] = useState<number | null>(null)
  const [settingsPhoto, setSettingsPhoto] = useState<Photo | null>(null)
  const [settingsRadius, setSettingsRadius] = useState(album.media_radius ?? 12)
  const [settingsFilter, setSettingsFilter] = useState<PhotoFilterChoice>('global')
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsError, setSettingsError] = useState('')

  const viewerPhotos = slideshowPhotoIds
    ? slideshowPhotoIds
        .map((id) => photos.find((photo) => photo.id === id))
        .filter((photo): photo is Photo => Boolean(photo))
    : photos
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
    }
  }

  function handleMediaTouchMove(e: React.TouchEvent<HTMLElement>) {
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
    const [dragged] = nextPhotos.splice(fromIndex, 1)
    nextPhotos.splice(toIndex, 0, dragged)
    void savePhotoOrder(nextPhotos.map((photo, index) => ({ ...photo, sort_order: index })))
  }

  function startReorderPress(photo: Photo, e: React.PointerEvent<HTMLDivElement>) {
    if (!isOwner || !ownerToken || reorderSaving) return
    clearReorderTimer()
    const tile = e.currentTarget
    const pointerId = e.pointerId
    reorderDragIdRef.current = photo.id
    reorderTimerRef.current = window.setTimeout(() => {
      reorderTimerRef.current = null
      reorderSuppressedClickRef.current = true
      setReorderDraggingId(photo.id)
      setReorderTargetId(photo.id)
      try {
        if (tile.isConnected) tile.setPointerCapture(pointerId)
      } catch {
      }
    }, 1000)
  }

  function handleReorderMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!reorderDragIdRef.current || !reorderDraggingId) return
    e.preventDefault()
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-photo-id]')
    const targetId = target?.dataset.photoId
    if (targetId) setReorderTargetId(targetId)
  }

  function finishReorder(e: React.PointerEvent<HTMLDivElement>) {
    clearReorderTimer()
    const dragId = reorderDraggingId
    const targetId = reorderTargetId
    reorderDragIdRef.current = null
    setReorderDraggingId(null)
    setReorderTargetId(null)
    if (dragId) {
      e.preventDefault()
      reorderSuppressedClickRef.current = true
      window.setTimeout(() => {
        reorderSuppressedClickRef.current = false
      }, 0)
      if (targetId) movePhoto(dragId, targetId)
    }
  }

  function handleTileClick(index: number) {
    if (reorderSuppressedClickRef.current) {
      reorderSuppressedClickRef.current = false
      return
    }
    setSlideshowActive(false)
    setSlideshowPaused(false)
    setSlideshowPhotoIds(null)
    openLightbox(index)
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
    if (selectedIds.length === 0) return
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

  useEffect(() => () => clearReorderTimer(), [])

  useEffect(() => {
    if (!slideshowRequestId || !isOwner || handledSlideshowRequestRef.current === slideshowRequestId) return
    handledSlideshowRequestRef.current = slideshowRequestId
    if (photos.length === 0) {
      showAppToast('Upload media before creating a slideshow.', 'error')
      return
    }
    setSlideshowSelectedIds(new Set(photos.map((photo) => photo.id)))
    setSlideshowPickerOpen(true)
  }, [isOwner, photos, slideshowRequestId])

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
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measureTiles)
    }
  }, [photos, onRadiusMaxChange])

  useEffect(() => {
    setLightboxMediaNode(null)
    setLightboxRadiusMax(null)
    resetZoom()
    setSwipeAnimating(false)
    setSwipeOffset(0)
    lastTapRef.current = 0
  }, [current?.id, resetZoom])

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
          const isReorderMode = reorderDraggingId != null
          const isReorderDragging = reorderDraggingId === photo.id
          const isReorderTarget = reorderDraggingId != null && reorderTargetId === photo.id && reorderDraggingId !== photo.id
          return (
            <div key={photo.id}>
              <div
                className={`${hover === 'lift' ? 'hush-hover-lift ' : ''}${isReorderMode ? 'hush-reorder-ring ' : ''}${isReorderDragging || isReorderTarget ? 'hush-reorder-ring-solid ' : ''}hush-photo-tile group relative aspect-square overflow-hidden cursor-pointer`}
                data-photo-id={photo.id}
                style={{
                  background: '#EDE7DB',
                  borderRadius: mediaRadius,
                  opacity: isReorderDragging ? 0.58 : 1,
                  touchAction: reorderDraggingId ? 'none' : 'manipulation',
                }}
                onClick={() => handleTileClick(index)}
                onPointerDown={(e) => startReorderPress(photo, e)}
                onPointerMove={handleReorderMove}
                onPointerUp={finishReorder}
                onPointerCancel={finishReorder}
                onPointerLeave={(e) => {
                  if (!reorderDraggingId) clearReorderTimer()
                  else handleReorderMove(e)
                }}
                onContextMenu={(e) => e.preventDefault()}
                onDragStart={(e) => e.preventDefault()}
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
                    draggable={false}
                    onError={() => {
                      if (!isVideo) markBroken(photo.id)
                    }}
                    onContextMenu={(e) => e.preventDefault()}
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

      {current && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center overflow-hidden${slideshowMode ? ' hush-slideshow-overlay' : ''}`} onClick={closeLightbox} onWheel={(e) => { if (!(e.target as HTMLElement).closest('[data-scroll-allowed="true"]')) e.preventDefault() }}>
          <div aria-hidden className="absolute inset-0" style={{ background: 'rgba(5, 8, 5, 0.92)' }} />

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
              window.setTimeout(() => setSwipeAnimating(false), 180)
            }}
          >
            {slideshowMode && (
              <div className="hush-slideshow-head" onClick={(e) => e.stopPropagation()}>
                <span>Slideshow</span>
                <strong>{(lightbox ?? 0) + 1} / {viewerPhotos.length}</strong>
              </div>
            )}

            {broken.has(current.id) ? (
              <div className="flex min-h-[240px] w-[min(92vw,720px)] flex-col items-center justify-center px-6 text-center" style={{ background: 'rgba(253,250,245,0.94)', borderRadius: previewRadiusFor(current) }} onClick={(e) => e.stopPropagation()}>
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
                className={`block max-h-[70vh] max-w-[92vw] object-contain${slideshowFrameClass}`}
                ref={(node) => {
                  lightboxVideoRef.current = node
                  setLightboxMediaNode(node)
                }}
                style={{ background: '#000', ...mediaZoomStyle(current) }}
                onClick={(e) => e.stopPropagation()}
                onEnded={() => {
                  if (slideshowActive && !slideshowPaused && viewerPhotos.length > 1) next()
                }}
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
            ) : (
              <div className={`flex h-[70vh] w-[min(92vw,1100px)] items-center justify-center overflow-hidden${slideshowFrameClass}`} key={current.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={current.url}
                  alt={current.caption || ''}
                  className="block max-h-full max-w-full object-contain"
                  ref={(node) => setLightboxMediaNode(node)}
                  style={mediaZoomStyle(current)}
                  onError={() => markBroken(current.id)}
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
              {(current.caption || current.author_name) && (
                <div className="text-center">
                  {current.caption && <p className="font-medium" style={{ color: '#FDFAF5' }}>{current.caption}</p>}
                  {current.author_name && <p className="text-sm" style={{ color: '#C5D9C2' }}>by {current.author_name}</p>}
                </div>
              )}

              <button onClick={(e) => { e.stopPropagation(); downloadPhoto(current) }} disabled={broken.has(current.id)} className="p-2 rounded-lg transition hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: 'rgba(255,255,255,0.15)', color: '#FDFAF5' }} title="Download">
                <Download className="w-5 h-5" />
              </button>
              {isOwner && (
                <>
                  <button onClick={(e) => { e.stopPropagation(); openSettings(current) }} className="p-2 rounded-lg transition hover:opacity-80" style={{ background: 'rgba(255,255,255,0.15)', color: '#FDFAF5' }} title="Settings">
                    <Settings className="w-5 h-5" />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); deletePhoto(current) }} disabled={deleting === current.id} className="p-2 rounded-lg transition hover:opacity-80 disabled:opacity-50" style={{ background: 'rgba(192,57,43,0.3)', color: '#FDFAF5' }} title="Delete">
                    <Trash2 className="w-5 h-5" />
                  </button>
                </>
              )}
            </div>

            {!slideshowMode && <p className="text-sm" style={{ color: '#8AB585' }}>{(lightbox ?? 0) + 1} / {viewerPhotos.length}</p>}

            {slideshowMode && viewerPhotos.length > 1 && (
              <div className="hush-slideshow-strip" data-scroll-allowed="true" onClick={(e) => e.stopPropagation()}>
                {viewerPhotos.map((photo, index) => {
                  const isActive = index === lightbox
                  const thumbSrc = photo.media_type === 'video' ? photo.poster_url || '' : photo.url
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
            className="relative z-10 w-[min(94vw,860px)] rounded-2xl p-4 sm:p-5"
            style={{ background: '#FDFAF5', border: '1px solid #DDD5C5', boxShadow: '0 24px 70px rgba(0,0,0,0.28)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-semibold" style={{ color: '#254F22', fontFamily: 'var(--font-serif)' }}>Create slideshow</h2>
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
                const thumbSrc = photo.media_type === 'video' ? photo.poster_url || '' : photo.url
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
              <button type="button" className="rounded-xl px-4 py-2 font-semibold transition hover:opacity-90 disabled:opacity-50" style={{ background: '#254F22', color: '#FDFAF5' }} disabled={slideshowSelectedIds.size === 0} onClick={createSlideshow}>
                Create slideshow
              </button>
            </div>
          </section>
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

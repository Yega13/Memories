import React, { useState, useRef, useEffect } from 'react'
import type { Photo } from '@/lib/supabase'

type Options = {
  lightbox: number | null
  currentId: string | undefined
  viewerPhotos: Photo[]
}

export type LightboxMedia = {
  lightboxMediaNode: HTMLElement | null
  setLightboxMediaNode: React.Dispatch<React.SetStateAction<HTMLElement | null>>
  lightboxRadiusMax: number | null
  lightboxOriginalLoadedIds: Set<string>
  setLightboxOriginalLoadedIds: React.Dispatch<React.SetStateAction<Set<string>>>
}

export function useLightboxMedia({ lightbox, currentId, viewerPhotos }: Options): LightboxMedia {
  const viewerPhotosRef = useRef<Photo[]>(viewerPhotos)
  viewerPhotosRef.current = viewerPhotos

  const [lightboxMediaNode, setLightboxMediaNode] = useState<HTMLElement | null>(null)
  const [lightboxRadiusMax, setLightboxRadiusMax] = useState<number | null>(null)
  const [lightboxOriginalLoadedIds, setLightboxOriginalLoadedIds] = useState<Set<string>>(new Set())

  // Reset media node + radius cap when the photo changes (node is replaced by a new DOM element).
  useEffect(() => {
    setLightboxMediaNode(null)
    setLightboxRadiusMax(null)
  }, [currentId])

  // Measure and track the radius cap as the lightbox media node resizes.
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

  // Prefetch the current original + ±2 neighbors. The browser image cache means the visible
  // <img> and every subsequent swipe paints from cache instead of starting a fresh multi-MB
  // download. Skip videos — their players manage their own buffering.
  useEffect(() => {
    if (lightbox === null) return
    if (typeof window === 'undefined') return
    const viewer = viewerPhotosRef.current
    for (const delta of [0, 1, -1, 2, -2]) {
      const i = lightbox + delta
      if (i < 0 || i >= viewer.length) continue
      const photo = viewer[i]
      if (!photo || !photo.url) continue
      if (photo.media_type === 'video') {
        // Pre-warm the HTTP cache for the current video and its immediate neighbors so
        // the <video preload="auto"> element finds the first chunk already cached.
        if (Math.abs(delta) > 1) continue
        const videoUrl = photo.mirror_url ?? photo.url
        if (!videoUrl) continue
        // Fetch the first 4 MB — enough for a short clip to begin playing immediately.
        fetch(videoUrl, {
          headers: { Range: 'bytes=0-4194303' },
          credentials: 'omit',
          cache: 'force-cache',
        }).catch(() => {})
        continue
      }
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

  return {
    lightboxMediaNode,
    setLightboxMediaNode,
    lightboxRadiusMax,
    lightboxOriginalLoadedIds,
    setLightboxOriginalLoadedIds,
  }
}

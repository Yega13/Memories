import { useRef, useEffect, useCallback, type MutableRefObject } from 'react'
import type { MediaType } from '@/lib/supabase'

type Options = {
  active: boolean
  paused: boolean
  lightbox: number | null
  viewerPhotosLength: number
  currentId: string | undefined
  currentMediaType: MediaType | undefined
  intervalMs: number
  onNext: () => void
}

export type SlideshowTimer = {
  clear: () => void
  startedAtRef: MutableRefObject<number>
  remainingMsRef: MutableRefObject<number | null>
}

export function useSlideshowTimer({
  active,
  paused,
  lightbox,
  viewerPhotosLength,
  currentId,
  currentMediaType,
  intervalMs,
  onNext,
}: Options): SlideshowTimer {
  const timerRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const remainingMsRef = useRef<number | null>(null)
  // Keep a ref to onNext so we never include it as an effect dep — its identity changes
  // when viewerPhotos.length changes, which would restart the timer mid-slideshow.
  const onNextRef = useRef(onNext)
  onNextRef.current = onNext

  const clear = useCallback(() => {
    if (timerRef.current === null) return
    window.clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  // Reset remaining when the photo changes or the interval setting changes.
  useEffect(() => {
    remainingMsRef.current = intervalMs
  }, [currentId, intervalMs])

  // Main timer: start, restart on relevant changes, and self-cancel on cleanup.
  useEffect(() => {
    clear()
    if (!active || paused || lightbox === null || viewerPhotosLength < 2 || currentMediaType === 'video') {
      if (!paused) remainingMsRef.current = intervalMs
      return
    }

    const duration = Math.max(250, Math.min(intervalMs, remainingMsRef.current ?? intervalMs))
    remainingMsRef.current = duration
    startedAtRef.current = Date.now()
    timerRef.current = window.setTimeout(() => {
      remainingMsRef.current = intervalMs
      onNextRef.current()
    }, duration)

    return clear
  }, [active, paused, lightbox, viewerPhotosLength, currentId, currentMediaType, intervalMs, clear])

  return { clear, startedAtRef, remainingMsRef }
}

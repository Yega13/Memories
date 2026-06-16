
import type { Tier } from '@/lib/subscriptions'

export type MediaKind = 'image' | 'video'

const MB = 1024 * 1024
const GB = 1024 * MB

export const FREE_IMAGE_BYTES = 25 * MB
export const FREE_VIDEO_BYTES = 200 * MB

export const PRO_IMAGE_BYTES = 200 * MB
export const PRO_VIDEO_BYTES = 1 * GB

export type UploadCaps = { image: number; video: number }

export function uploadCapsForTier(tier: Tier): UploadCaps {
  if (tier === 'pro' || tier === 'studio') {
    return { image: PRO_IMAGE_BYTES, video: PRO_VIDEO_BYTES }
  }
  return { image: FREE_IMAGE_BYTES, video: FREE_VIDEO_BYTES }
}

export const DEFAULT_UPLOAD_CAPS: UploadCaps = uploadCapsForTier('free')

const IMAGE_EXT_FALLBACK = /\.(jpe?g|png|gif|webp|heic|heif|avif)$/i
const VIDEO_EXT_FALLBACK = /\.(mp4|mov|m4v|webm|ogg)$/i

export function detectKind(file: File): MediaKind | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (IMAGE_EXT_FALLBACK.test(file.name)) return 'image'
  if (VIDEO_EXT_FALLBACK.test(file.name)) return 'video'
  return null
}

export function extensionFor(file: File, kind: MediaKind): string {
  const fromName = file.name.split('.').pop()?.toLowerCase()
  if (fromName && fromName.length <= 5) return fromName
  return kind === 'video' ? 'mp4' : 'jpg'
}

export type PosterResult = {
  blob: Blob
  width: number
  height: number
  durationSeconds: number
}

export async function generateVideoPoster(file: File): Promise<PosterResult | null> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  // preload='auto' tells the browser to buffer eagerly. For blob: URLs (local files)
  // this has no network cost. 'metadata' was used before but iOS Safari strictly
  // respects it and never fires loadeddata, causing every poster job to time out.
  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  video.src = url

  try {
    // loadedmetadata fires as soon as the moov atom is parsed — reliable on all browsers
    // including iOS Safari. loadeddata (the previous listener) requires frame pixel data
    // to be available, which 'preload=metadata' actively prevents on strict browsers.
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('loadedmetadata', () => resolve(), { once: true })
      video.addEventListener('error', () => reject(new Error('video decode failed')), { once: true })
    })

    // Seek to 5% of duration (capped at 0.5 s) to avoid black leader frames.
    const target = Math.min(0.5, Math.max(0, (video.duration || 1) * 0.05))
    video.currentTime = target

    // seeked fires once the browser has decoded the frame at the new position —
    // at that point drawImage will capture real pixel data, not a black frame.
    await new Promise<void>((resolve, reject) => {
      video.addEventListener('seeked', () => resolve(), { once: true })
      video.addEventListener('error', () => reject(new Error('seek failed')), { once: true })
    })

    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) return null

    // Cap the poster's longest dimension at 720 px. The poster is used as a grid thumbnail and
    // the lightbox stand-in, neither of which need full source resolution. Allocating a 1920×1080
    // (or 3840×2160) canvas + doing the full-res drawImage on the main thread was the cause of
    // the 20–30 s "freeze" users were seeing before chunk uploads even started.
    const MAX_POSTER_DIM = 720
    const longest = Math.max(w, h)
    const scale = longest > MAX_POSTER_DIM ? MAX_POSTER_DIM / longest : 1
    const cw = Math.max(1, Math.round(w * scale))
    const ch = Math.max(1, Math.round(h * scale))

    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, cw, ch)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85),
    )
    if (!blob) return null

    return {
      blob,
      width: cw,
      height: ch,
      durationSeconds: Number.isFinite(video.duration) ? video.duration : 0,
    }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return ''
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

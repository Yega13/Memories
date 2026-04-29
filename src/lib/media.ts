// Browser-only media helpers for the upload flow.
// Don't import from server code — these touch DOM APIs.

export type MediaKind = 'image' | 'video'

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024 // 25 MB — matches FAQ copy
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024 // 100 MB — beta cap

const VIDEO_MIME_PREFIXES = ['video/']
const VIDEO_EXT_FALLBACK = /\.(mp4|mov|m4v|webm|ogg)$/i

export function detectKind(file: File): MediaKind | null {
  if (file.type.startsWith('image/')) return 'image'
  if (VIDEO_MIME_PREFIXES.some((p) => file.type.startsWith(p))) return 'video'
  // Some HEIC/MOV files come through with empty MIME on Safari/iOS.
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

// Decode the first viable frame of a video file and rasterise it to a JPEG.
// Returns null if the browser can't decode the video (e.g. unsupported codec).
export async function generateVideoPoster(file: File): Promise<PosterResult | null> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  video.playsInline = true
  video.crossOrigin = 'anonymous'
  video.src = url

  try {
    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => resolve()
      const onError = () => reject(new Error('video decode failed'))
      video.addEventListener('loadeddata', onLoaded, { once: true })
      video.addEventListener('error', onError, { once: true })
    })

    // Seek a touch in so we don't get a black first frame.
    const target = Math.min(0.5, Math.max(0, (video.duration || 1) * 0.05))
    if (Number.isFinite(target) && target > 0) {
      await new Promise<void>((resolve, reject) => {
        const onSeeked = () => resolve()
        const onError = () => reject(new Error('seek failed'))
        video.addEventListener('seeked', onSeeked, { once: true })
        video.addEventListener('error', onError, { once: true })
        video.currentTime = target
      })
    }

    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) return null

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0, w, h)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85),
    )
    if (!blob) return null

    return {
      blob,
      width: w,
      height: h,
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

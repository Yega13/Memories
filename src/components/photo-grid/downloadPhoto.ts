import { showAppToast } from '@/components/AppToast'
import type { Photo } from '@/lib/supabase'

export async function downloadPhoto(photo: Photo): Promise<void> {
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

  // Fetch directly from Supabase/R2 — avoids the server proxy which strips EXIF
  // segments that some camera-produced JPEGs need to pass createImageBitmap on re-upload.
  // Supabase public buckets ship Access-Control-Allow-Origin: * so cross-origin fetch works.
  // Blob URL approach forces a real file download in all browsers including mobile Safari.
  try {
    const res = await fetch(sourceUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
  } catch {
    // CORS failure for R2 or network error — fall back to the proxy route
    const a = document.createElement('a')
    a.href = `/api/download/photo?url=${encodeURIComponent(sourceUrl)}&name=${encodeURIComponent(filename)}`
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }
}

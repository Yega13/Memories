import { showAppToast } from '@/components/AppToast'
import type { Photo } from '@/lib/supabase'

export function downloadPhoto(photo: Photo): void {
  // For Stream-backed videos prefer the R2 mirror URL (the original mp4) over the iframe URL,
  // which isn't directly downloadable. If the mirror hasn't been written yet (background job
  // still pending, or migration not applied) we show the "not downloadable yet" toast.
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

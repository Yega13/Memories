// Runs off the main thread. Fetches photos one at a time, streams them through
// client-zip, and transfers each zip chunk back to the main thread as it's ready.
// This avoids both: (1) blocking the browser main thread with CRC32 computation,
// and (2) holding all photo data in memory at once.

import { downloadZip } from 'client-zip'

declare const self: DedicatedWorkerGlobalScope

type PhotoInfo = {
  url: string | null
  storage_path: string | null
  storage_backend: string | null
  media_type: string | null
  mirror_url: string | null
  mirror_path: string | null
  caption: string | null
}

function resolveDownloadUrl(photo: PhotoInfo): string | null {
  return (photo.storage_backend === 'stream' ? photo.mirror_url : photo.url) ?? null
}

function buildFilename(photo: PhotoInfo, index: number, folder: string): string {
  const sp = photo.storage_backend === 'stream'
    ? (photo.mirror_path ?? photo.storage_path ?? '')
    : (photo.storage_path ?? '')
  const rawUrl = photo.storage_backend === 'stream'
    ? (photo.mirror_url ?? photo.url ?? '')
    : (photo.url ?? '')
  const ext = sp.split('.').pop()?.toLowerCase()
    || rawUrl.split('.').pop()?.split('?')[0]?.toLowerCase()
    || (photo.media_type === 'video' ? 'mp4' : 'jpg')
  const prefix = photo.media_type === 'video' ? 'video' : 'photo'
  const base = photo.caption
    ? `${index + 1}-${photo.caption.replace(/[^a-z0-9]/gi, '_').slice(0, 50)}.${ext}`
    : `${prefix}-${index + 1}.${ext}`
  return `${folder}/${base}`
}

async function* photoEntries(photos: PhotoInfo[], folder: string) {
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i]
    const rawUrl = resolveDownloadUrl(photo)
    if (!rawUrl) continue

    // Try direct fetch first (fastest). Fall back to our proxy for CORS-blocked origins.
    let res: Response | null = null
    try {
      const r = await fetch(rawUrl)
      if (r.ok) res = r
    } catch { /* try proxy */ }

    if (!res) {
      try {
        const r = await fetch(`/api/download/photo?url=${encodeURIComponent(rawUrl)}&name=photo`)
        if (r.ok) res = r
      } catch { /* skip */ }
    }

    if (!res) continue

    yield {
      name: buildFilename(photo, i, folder),
      input: res,
      lastModified: new Date(0),
    }

    self.postMessage({ type: 'progress', done: i + 1, total: photos.length })
  }
}

self.onmessage = async (e: MessageEvent<{ photos: PhotoInfo[]; folder: string }>) => {
  const { photos, folder } = e.data
  try {
    const zipResponse = downloadZip(photoEntries(photos, folder))
    const reader = zipResponse.body!.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) { self.postMessage({ type: 'done' }); break }
      // slice so we own the buffer before transferring (avoids neutering the original view)
      const buf = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)
      self.postMessage({ type: 'chunk', data: buf }, [buf] as unknown as Transferable[])
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : 'Zip failed' })
  }
}

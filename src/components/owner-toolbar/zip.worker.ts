// Runs off the main thread. Fetches photos, fully buffers their bodies in parallel,
// then streams them through client-zip, transferring each zip chunk back to the main
// thread as it's ready. Bodies are downloaded PREFETCH-at-a-time so client-zip only
// waits on CPU (CRC32), never on the network.

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

// Fetches and fully buffers a photo body so callers get a Uint8Array, not a stream.
// This lets PREFETCH concurrent bodies download in true parallel — client-zip then
// only does CPU work (CRC32) with no network stall between entries.
async function fetchBuffer(rawUrl: string): Promise<Uint8Array | null> {
  const tryFetch = async (url: string) => {
    try {
      const r = await fetch(url)
      if (r.ok) return new Uint8Array(await r.arrayBuffer())
    } catch { /* fall through */ }
    return null
  }
  return (
    (await tryFetch(rawUrl)) ??
    (await tryFetch(`/api/download/photo?url=${encodeURIComponent(rawUrl)}&name=photo`))
  )
}

// Yields entries in album order. Up to PREFETCH body downloads run concurrently so
// client-zip never stalls on the network — it only waits on CPU (CRC32 + framing).
async function* photoEntries(photos: PhotoInfo[], folder: string) {
  // Each in-flight slot downloads a full body into a Uint8Array before client-zip
  // asks for it. Memory cost: PREFETCH × avg_photo_size (e.g. 8 × 5 MB = 40 MB).
  const PREFETCH = 8
  const queue: Array<Promise<{ buf: Uint8Array | null; i: number }>> = []

  let nextFetch = 0
  let yielded = 0

  function enqueue() {
    while (queue.length < PREFETCH && nextFetch < photos.length) {
      const i = nextFetch++
      const rawUrl = resolveDownloadUrl(photos[i])
      queue.push(
        (rawUrl ? fetchBuffer(rawUrl) : Promise.resolve(null)).then((buf) => ({ buf, i })),
      )
    }
  }

  enqueue()

  while (queue.length > 0) {
    const { buf, i } = await queue.shift()!
    enqueue() // start next fetch as soon as we dequeue one

    if (buf) {
      yield {
        name: buildFilename(photos[i], i, folder),
        input: buf,
        // lastModified omitted — client-zip defaults to current date.
        // new Date(0) = 1970 underflows the MS-DOS date format (min 1980) → wraps to 2098.
      }
    }

    yielded++
    self.postMessage({ type: 'progress', done: yielded, total: photos.length })
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

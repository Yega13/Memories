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

async function fetchPhoto(rawUrl: string): Promise<Response | null> {
  try {
    const r = await fetch(rawUrl)
    if (r.ok) return r
  } catch { /* try proxy */ }
  try {
    const r = await fetch(`/api/download/photo?url=${encodeURIComponent(rawUrl)}&name=photo`)
    if (r.ok) return r
  } catch { /* skip */ }
  return null
}

// Yields entries in album order, but starts up to PREFETCH_COUNT fetches ahead so
// network bandwidth is kept busy while client-zip processes the previous entry.
async function* photoEntries(photos: PhotoInfo[], folder: string) {
  const PREFETCH = 4
  // Queue of [Promise<Response|null>, photoIndex] — always PREFETCH items ahead of what we yield
  const queue: Array<Promise<{ res: Response | null; i: number }>> = []

  let nextFetch = 0
  let yielded = 0

  function enqueue() {
    while (queue.length < PREFETCH && nextFetch < photos.length) {
      const i = nextFetch++
      const rawUrl = resolveDownloadUrl(photos[i])
      queue.push(
        (rawUrl ? fetchPhoto(rawUrl) : Promise.resolve(null)).then((res) => ({ res, i })),
      )
    }
  }

  enqueue()

  while (queue.length > 0) {
    const { res, i } = await queue.shift()!
    enqueue() // start next fetch as soon as we dequeue one

    if (res) {
      yield {
        name: buildFilename(photos[i], i, folder),
        input: res,
        lastModified: new Date(0),
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

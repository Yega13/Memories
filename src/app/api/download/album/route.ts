import { NextResponse } from 'next/server'
import archiver from 'archiver'
import { PassThrough } from 'stream'
import type { Readable } from 'stream'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookie } from '@/lib/album-owner-access'

export const runtime = 'nodejs'
export const maxDuration = 300

const ALLOWED_HOSTS = new Set([
  'zleajzevvhugkwlqlolt.supabase.co',
  'videos.hushare.space',
])

type AlbumRow = {
  id: string
  owner_token: string
  user_id: string | null
  title: string | null
}

type PhotoRow = {
  url: string | null
  storage_path: string | null
  storage_backend: string | null
  media_type: string | null
  mirror_url: string | null
  mirror_path: string | null
  caption: string | null
}

function resolveDownloadUrl(photo: PhotoRow): string | null {
  const url = photo.storage_backend === 'stream' ? photo.mirror_url : photo.url
  if (!url) return null
  try {
    const { hostname } = new URL(url)
    return ALLOWED_HOSTS.has(hostname) ? url : null
  } catch {
    return null
  }
}

function buildFilename(photo: PhotoRow, index: number, folder: string): string {
  const storagePath =
    photo.storage_backend === 'stream'
      ? (photo.mirror_path ?? photo.storage_path ?? '')
      : (photo.storage_path ?? '')
  const rawUrl =
    photo.storage_backend === 'stream'
      ? (photo.mirror_url ?? photo.url ?? '')
      : (photo.url ?? '')
  const ext =
    storagePath.split('.').pop()?.toLowerCase() ||
    rawUrl.split('.').pop()?.split('?')[0]?.toLowerCase() ||
    (photo.media_type === 'video' ? 'mp4' : 'jpg')
  const prefix = photo.media_type === 'video' ? 'video' : 'photo'
  const base = photo.caption
    ? `${index + 1}-${photo.caption.replace(/[^a-z0-9]/gi, '_').slice(0, 50)}.${ext}`
    : `${prefix}-${index + 1}.${ext}`
  return `${folder}/${base}`
}

export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get('slug')?.trim() ?? ''
  if (!slug) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400 })
  }

  const access = await verifyOwnerViaCookie<AlbumRow>(slug, 'title')
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const admin = createAdminClient()
  const { data: photos } = await admin
    .from('photos')
    .select('url, storage_path, storage_backend, media_type, mirror_url, mirror_path, caption')
    .eq('album_id', access.album.id)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true })

  if (!photos?.length) {
    return NextResponse.json({ error: 'No photos in this album' }, { status: 404 })
  }

  const albumTitle = access.album.title ?? slug
  const folder = albumTitle.replace(/[/\\:<>"|?*]/g, '-').slice(0, 100)

  const zip = archiver('zip', { store: true })
  zip.on('error', (err) => console.error('[download/album] archiver error:', err.message))

  // Wrap the Node.js Readable (archiver) as a Web ReadableStream so it can be
  // returned directly as the Response body and streamed to the browser.
  const responseBody = new ReadableStream<Uint8Array>({
    start(ctrl) {
      const r = zip as unknown as Readable
      r.on('data', (chunk: Buffer) => ctrl.enqueue(new Uint8Array(chunk)))
      r.on('end', () => ctrl.close())
      r.on('error', (e) => ctrl.error(e))
    },
    cancel() {
      zip.abort()
    },
  })

  // Fetch photos one at a time and pipe into the zip stream. Runs in the background
  // after the Response is returned so the browser starts receiving zip headers immediately.
  void (async () => {
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i] as PhotoRow
      const url = resolveDownloadUrl(photo)
      if (!url) continue

      // PassThrough bridges the fetch ReadableStream with archiver's entry queue.
      const pass = new PassThrough()
      // Register the end-of-entry promise BEFORE we start fetching, to avoid
      // a race where the stream could close before we await it.
      const entryDone = new Promise<void>((resolve) => {
        pass.once('end', resolve)
        pass.once('error', resolve)
      })

      zip.append(pass, { name: buildFilename(photo, i, folder) })

      try {
        const res = await fetch(url, { signal: req.signal })
        if (res.ok && res.body) {
          const reader = res.body.getReader()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            pass.write(Buffer.from(value))
          }
        }
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') {
          zip.abort()
          return
        }
        // Network error on a single photo — close its entry and continue.
      } finally {
        pass.end()
      }

      await entryDone
    }
    zip.finalize()
  })()

  return new Response(responseBody, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(albumTitle)}.zip"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyOwnerViaCookie } from '@/lib/album-owner-access'

export const runtime = 'nodejs'
export const maxDuration = 300

// Only fetch from our own storage hosts to prevent SSRF.
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

// ─── CRC-32 (pure JS) ─────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[i] = c
  }
  return t
})()

function updateCrc32(crc: number, data: Uint8Array): number {
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8)
  }
  return crc
}

// ─── MS-DOS date/time ─────────────────────────────────────────────────────────

function msDosDateTime(): [number, number] {
  const d = new Date()
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return [time, date]
}

// ─── ZIP helpers (STORE, no compression) ─────────────────────────────────────

function u16le(view: DataView, offset: number, value: number) { view.setUint16(offset, value, true) }
function u32le(view: DataView, offset: number, value: number) { view.setUint32(offset, value, true) }

function localFileHeader(nameBytes: Uint8Array, crc: number, size: number, modTime: number, modDate: number): Uint8Array {
  const buf = new Uint8Array(30 + nameBytes.length)
  const v = new DataView(buf.buffer)
  u32le(v, 0, 0x04034b50)        // signature
  u16le(v, 4, 20)                 // version needed (2.0)
  // bytes 6-7: general purpose bit flag = 0 (sizes/CRC in header, no data descriptor)
  // bytes 8-9: compression = 0 (STORE)
  u16le(v, 10, modTime)
  u16le(v, 12, modDate)
  u32le(v, 14, crc)
  u32le(v, 18, size)              // compressed size
  u32le(v, 22, size)              // uncompressed size
  u16le(v, 26, nameBytes.length)
  buf.set(nameBytes, 30)
  return buf
}

function centralDirRecord(nameBytes: Uint8Array, crc: number, size: number, localHeaderOffset: number, modTime: number, modDate: number): Uint8Array {
  const buf = new Uint8Array(46 + nameBytes.length)
  const v = new DataView(buf.buffer)
  u32le(v, 0, 0x02014b50)
  u16le(v, 4, 20)                  // version made by
  u16le(v, 6, 20)                  // version needed
  u16le(v, 8, 0)                   // bit flag = 0 (must match local file header)
  // bytes 10-11: compression = 0 (STORE)
  u16le(v, 12, modTime)
  u16le(v, 14, modDate)
  u32le(v, 16, crc)
  u32le(v, 20, size)
  u32le(v, 24, size)
  u16le(v, 28, nameBytes.length)
  u32le(v, 42, localHeaderOffset)
  buf.set(nameBytes, 46)
  return buf
}

function endOfCentralDir(entryCount: number, cdSize: number, cdOffset: number): Uint8Array {
  const buf = new Uint8Array(22)
  const v = new DataView(buf.buffer)
  u32le(v, 0, 0x06054b50)
  u16le(v, 8, entryCount)
  u16le(v, 10, entryCount)
  u32le(v, 12, cdSize)
  u32le(v, 16, cdOffset)
  return buf
}

// ─── URL / filename helpers ───────────────────────────────────────────────────

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
  const sp = photo.storage_backend === 'stream' ? (photo.mirror_path ?? photo.storage_path ?? '') : (photo.storage_path ?? '')
  const rawUrl = photo.storage_backend === 'stream' ? (photo.mirror_url ?? photo.url ?? '') : (photo.url ?? '')
  const ext = sp.split('.').pop()?.toLowerCase() || rawUrl.split('.').pop()?.split('?')[0]?.toLowerCase() || (photo.media_type === 'video' ? 'mp4' : 'jpg')
  const prefix = photo.media_type === 'video' ? 'video' : 'photo'
  const base = photo.caption
    ? `${index + 1}-${photo.caption.replace(/[^a-z0-9]/gi, '_').slice(0, 50)}.${ext}`
    : `${prefix}-${index + 1}.${ext}`
  return `${folder}/${base}`
}

// ─── Main fill loop ───────────────────────────────────────────────────────────

// Fully buffers each photo so CRC32 and size are known before writing the local
// file header (data descriptor / bit-3 is not supported by iOS Files or most
// Android zip tools). No req.signal — Cloudflare fires it as a soft timeout on
// slow connections before the client actually disconnects, which was causing
// partial ZIPs on mobile.
async function fetchBuffer(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

async function fillZip(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  photos: PhotoRow[],
  folder: string,
): Promise<void> {
  // Up to PREFETCH photo bodies download concurrently on the server's internal
  // network while the previous entry's CRC32 is computed.
  const PREFETCH = 8
  const queue: Array<Promise<{ buf: Uint8Array | null; i: number }>> = []
  let nextFetch = 0

  function enqueue() {
    while (queue.length < PREFETCH && nextFetch < photos.length) {
      const i = nextFetch++
      const url = resolveDownloadUrl(photos[i])
      queue.push(
        (url ? fetchBuffer(url) : Promise.resolve(null)).then((buf) => ({ buf, i })),
      )
    }
  }

  enqueue()

  const [modTime, modDate] = msDosDateTime()
  const entries: { nameBytes: Uint8Array; crc: number; size: number; offset: number }[] = []
  let offset = 0

  while (queue.length > 0) {
    const { buf, i } = await queue.shift()!
    enqueue()

    const photo = photos[i]
    const nameBytes = new TextEncoder().encode(buildFilename(photo, i, folder))
    const localOffset = offset

    // Failed fetch → 0-byte entry keeps the zip valid and the file count intact.
    const data = buf ?? new Uint8Array(0)
    let crc = 0xFFFFFFFF
    crc = updateCrc32(crc, data)
    crc = (crc ^ 0xFFFFFFFF) >>> 0

    const header = localFileHeader(nameBytes, crc, data.length, modTime, modDate)
    await writer.write(header)
    if (data.length > 0) await writer.write(data)
    offset += header.length + data.length
    entries.push({ nameBytes, crc, size: data.length, offset: localOffset })
  }

  // Central directory
  const cdOffset = offset
  let cdSize = 0
  for (const e of entries) {
    const rec = centralDirRecord(e.nameBytes, e.crc, e.size, e.offset, modTime, modDate)
    await writer.write(rec)
    cdSize += rec.length
  }

  await writer.write(endOfCentralDir(entries.length, cdSize, cdOffset))
  await writer.close()
}

// ─── Route handler ────────────────────────────────────────────────────────────

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

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
  const writer = writable.getWriter()

  void fillZip(writer, photos as PhotoRow[], folder).catch(async (err) => {
    try { await writer.abort(err) } catch {}
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(albumTitle)}.zip"`,
      'Cache-Control': 'private, no-store',
      'X-Photo-Count': String(photos.length),
    },
  })
}

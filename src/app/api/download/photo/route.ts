import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Only allow fetching from our own storage hosts — prevents SSRF
const ALLOWED_HOSTS = new Set([
  'zleajzevvhugkwlqlolt.supabase.co',
  'videos.hushare.space',
])

const NO_STORE = { 'Cache-Control': 'private, no-store' }

// Max image size to buffer for EXIF stripping. Larger files stream through.
const MAX_EXIF_STRIP_BYTES = 25 * 1024 * 1024

// Pure-JS EXIF/APP1 strip for JPEG. Works in Cloudflare Workers (sharp does not).
// Walks the segment list and drops APP1 (where EXIF lives); copies everything else verbatim.
function stripExifFromJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
  const keep: Uint8Array[] = [bytes.subarray(0, 2)]
  let i = 2
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) break
    const marker = bytes[i + 1]
    // SOS (start of scan) — image data follows; copy the remainder verbatim
    if (marker === 0xda) {
      keep.push(bytes.subarray(i))
      break
    }
    // Standalone markers without a length field (RSTn / SOI / EOI / TEM)
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      keep.push(bytes.subarray(i, i + 2))
      i += 2
      continue
    }
    if (i + 4 > bytes.length) break
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3]
    const segEnd = i + 2 + segLen
    if (segEnd > bytes.length) break
    // Drop APP1 (EXIF). Keep everything else, including APP0 (JFIF) for compatibility.
    if (marker !== 0xe1) {
      keep.push(bytes.subarray(i, segEnd))
    }
    i = segEnd
  }
  const total = keep.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of keep) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const rawUrl = searchParams.get('url') ?? ''
  const name = searchParams.get('name') ?? 'download'

  if (!rawUrl) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 })
  }

  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 })
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let upstream: Response
  try {
    upstream = await fetch(rawUrl)
  } catch {
    return NextResponse.json({ error: 'Fetch failed' }, { status: 502 })
  }

  if (!upstream.ok) {
    return NextResponse.json({ error: `Upstream ${upstream.status}` }, { status: 502 })
  }

  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
  const contentLength = upstream.headers.get('content-length')
  const disposition = `attachment; filename="${encodeURIComponent(name)}"`

  // Strip EXIF from JPEGs. We always buffer if it looks like a JPEG, because Supabase doesn't
  // always send Content-Length — relying on the header to gate buffering meant stripping was
  // silently skipped in production and EXIF leaked through.
  const isJpeg = /jpe?g/i.test(contentType) || /\.jpe?g$/i.test(name)
  if (isJpeg) {
    const buf = await upstream.arrayBuffer()
    const original = new Uint8Array(buf)
    if (original.byteLength <= MAX_EXIF_STRIP_BYTES) {
      let stripped: Uint8Array = original
      try {
        stripped = stripExifFromJpeg(original)
      } catch {
        // Malformed JPEG — fall through with original bytes
      }
      // Wrap in Blob — TypeScript's BodyInit union is finicky about Uint8Array variants across
      // Next.js + Workers type defs, but Blob is always accepted.
      return new NextResponse(new Blob([stripped as BlobPart], { type: 'image/jpeg' }), {
        headers: { 'Content-Type': 'image/jpeg', 'Content-Disposition': disposition, ...NO_STORE },
      })
    }
    // Too big to safely strip in Workers memory — return original bytes without stripping.
    return new NextResponse(new Blob([original as BlobPart], { type: 'image/jpeg' }), {
      headers: { 'Content-Type': 'image/jpeg', 'Content-Disposition': disposition, ...NO_STORE },
    })
  }

  // Stream videos and large/non-JPEG images directly — buffering a large video
  // into Workers memory causes crashes and "Site wasn't available".
  const responseHeaders: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Disposition': disposition,
    ...NO_STORE,
  }
  if (contentLength) responseHeaders['Content-Length'] = contentLength

  return new NextResponse(upstream.body, { headers: responseHeaders })
}

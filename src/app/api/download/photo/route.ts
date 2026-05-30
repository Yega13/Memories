import { NextResponse } from 'next/server'
import { stripExifFromJpeg } from '@/lib/exif'

export const runtime = 'nodejs'

// Only allow fetching from our own storage hosts — prevents SSRF
const ALLOWED_HOSTS = new Set([
  'zleajzevvhugkwlqlolt.supabase.co',
  'videos.hushare.space',
])

const NO_STORE = { 'Cache-Control': 'private, no-store' }

// Max image size to buffer for EXIF stripping. Larger files stream through.
const MAX_EXIF_STRIP_BYTES = 25 * 1024 * 1024


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

  const jpegHeaders = { 'Content-Type': 'image/jpeg', 'Content-Disposition': disposition, ...NO_STORE }

  // Strip EXIF from JPEGs. If Content-Length tells us the file exceeds the safe-buffer threshold,
  // skip buffering entirely and stream it — otherwise a 100 MB JPEG from a Pro upload would OOM
  // the Worker. When Content-Length is absent (Supabase sometimes omits it), buffer and check
  // actual size after the fact, then stream the already-buffered bytes back out.
  const isJpeg = /jpe?g/i.test(contentType) || /\.jpe?g$/i.test(name)
  if (isJpeg) {
    const knownSize = contentLength ? parseInt(contentLength, 10) : 0
    if (knownSize > MAX_EXIF_STRIP_BYTES) {
      // Large file (known from header) — stream without stripping to avoid OOM
      if (contentLength) jpegHeaders['Content-Length' as keyof typeof jpegHeaders] = contentLength
      return new NextResponse(upstream.body, { headers: jpegHeaders })
    }

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
        headers: jpegHeaders,
      })
    }
    // Buffered but turned out larger than MAX_EXIF_STRIP_BYTES (Content-Length was absent).
    // Return the already-buffered bytes without stripping.
    return new NextResponse(new Blob([original as BlobPart], { type: 'image/jpeg' }), {
      headers: jpegHeaders,
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

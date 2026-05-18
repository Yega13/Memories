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

  // Strip EXIF from JPEGs that are small enough to buffer safely in Workers memory
  const isJpeg = /jpe?g/i.test(contentType) || /\.jpe?g$/i.test(name)
  const knownBytes = contentLength ? parseInt(contentLength, 10) : Infinity
  if (isJpeg && knownBytes <= MAX_EXIF_STRIP_BYTES) {
    try {
      const buffer = Buffer.from(await upstream.arrayBuffer())
      const { default: sharp } = await import('sharp')
      const stripped = await sharp(buffer).jpeg({ quality: 100 }).toBuffer()
      return new NextResponse(new Uint8Array(stripped), {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Disposition': disposition,
          ...NO_STORE,
        },
      })
    } catch {
      // sharp failed — fall through to streaming passthrough
    }
  }

  // Stream videos and large/non-JPEG images directly — buffering a 200 MB
  // video into Workers memory causes crashes and "Site wasn't available".
  const responseHeaders: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Disposition': disposition,
    ...NO_STORE,
  }
  if (contentLength) responseHeaders['Content-Length'] = contentLength

  return new NextResponse(upstream.body, { headers: responseHeaders })
}

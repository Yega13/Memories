import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUserTierById } from '@/lib/subscriptions'
import { uploadCapsForTier } from '@/lib/media'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { streamConfig, streamUrls } from '@/lib/cloudflare-stream'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const STREAM_API_BASE = 'https://api.cloudflare.com/client/v4'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ALLOWED_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/ogg',
  'video/x-m4v',
])

function tusMetadata(fields: Record<string, string>) {
  return Object.entries(fields)
    .map(([key, value]) => `${key} ${Buffer.from(value).toString('base64')}`)
    .join(',')
}

function uidFromLocation(location: string) {
  const trimmed = location.split('?')[0].replace(/\/+$/, '')
  return trimmed.split('/').pop() ?? ''
}

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  const config = streamConfig()
  if (!config) {
    return NextResponse.json({ error: 'Cloudflare Stream is not configured' }, { status: 503, headers: NO_STORE })
  }

  let body: { albumId?: string; filename?: string; contentType?: string; totalSize?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const albumId = String(body.albumId ?? '').trim()
  const filename = String(body.filename ?? 'video.mp4').trim().slice(0, 128)
  const contentType = String(body.contentType ?? 'video/mp4').trim()
  const totalSize = Number(body.totalSize ?? 0)

  if (!UUID_RE.test(albumId)) {
    return NextResponse.json({ error: 'Invalid albumId' }, { status: 400, headers: NO_STORE })
  }
  if (!Number.isFinite(totalSize) || totalSize <= 0) {
    return NextResponse.json({ error: 'Invalid file size' }, { status: 400, headers: NO_STORE })
  }
  if (!ALLOWED_VIDEO_MIMES.has(contentType)) {
    return NextResponse.json({ error: 'Unsupported content type' }, { status: 415, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: ownerRow } = await admin
    .from('albums')
    .select('user_id')
    .eq('id', albumId)
    .maybeSingle<{ user_id: string | null }>()
  if (!ownerRow) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }

  const ownerTier = await getUserTierById(ownerRow.user_id)
  const caps = uploadCapsForTier(ownerTier)
  if (totalSize > caps.video) {
    return NextResponse.json(
      { error: `File exceeds the ${caps.video}-byte limit for this album` },
      { status: 413, headers: NO_STORE },
    )
  }

  const streamInitSignal = AbortSignal.timeout(8_000)
  let res: Response
  try {
    res = await fetch(`${STREAM_API_BASE}/accounts/${config.accountId}/stream?direct_user=true`, {
      method: 'POST',
      signal: streamInitSignal,
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Tus-Resumable': '1.0.0',
        'Upload-Length': String(Math.round(totalSize)),
        'Upload-Metadata': tusMetadata({
          name: filename,
          filename,
          filetype: contentType,
          album: albumId,
        }),
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[upload/stream/tus] init fetch failed:', msg)
    return NextResponse.json({ error: 'Stream service unavailable' }, { status: 502, headers: NO_STORE })
  }

  const uploadUrl = res.headers.get('location') ?? ''
  const uid = res.headers.get('stream-media-id') ?? uidFromLocation(uploadUrl)
  if (!res.ok || !uploadUrl || !uid) {
    const text = await res.text().catch(() => '')
    console.error('[upload/stream/tus] create failed:', res.status, text)
    // Include a sliver of the upstream body so client console can identify whether this is
    // an auth/permission problem (401/403) vs a config problem (400) vs a CF outage. The body
    // is truncated to avoid leaking anything sensitive in user-facing toasts.
    const detail = text ? ` (${text.slice(0, 180)})` : ''
    return NextResponse.json(
      { error: `Could not create Stream upload: HTTP ${res.status}${detail}` },
      { status: 502, headers: NO_STORE },
    )
  }

  return NextResponse.json({ uploadUrl, ...streamUrls(uid) }, { headers: NO_STORE })
}

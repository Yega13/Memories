import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { deleteStreamVideo } from '@/lib/cloudflare-stream'
import type { R2Env } from '@/lib/r2'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Attaches an R2 mirror (original-file copy) to a Stream-backed video row. Called from the
// background mirror queue in UploadZone after the same File has been uploaded to R2 via
// /api/upload/r2 with kind='video'.
//
// Auth: same guest-friendly model as upload + poster. Scoped to the album by storage_path
// prefix. "mirror_path IS NULL" guard prevents overwrites/replays.
//
// Degrades gracefully when the migration adding mirror_path/mirror_url is not yet applied:
// the UPDATE will fail with a column-not-found error and we silently return 200 ok — the
// Stream video already plays, only the download feature is unavailable until the column lands.
export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: {
    album_id?: string
    storage_path?: string
    mirror_path?: string
    mirror_url?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const albumId = String(body.album_id ?? '').trim()
  const storagePath = String(body.storage_path ?? '').trim()
  const mirrorPath = String(body.mirror_path ?? '').trim()
  const mirrorUrl = String(body.mirror_url ?? '').trim()

  if (!UUID_RE.test(albumId)) {
    return NextResponse.json({ error: 'Invalid album_id' }, { status: 400, headers: NO_STORE })
  }
  if (!storagePath.startsWith(`${albumId}/`)) {
    return NextResponse.json({ error: 'storage_path must be scoped to album' }, { status: 400, headers: NO_STORE })
  }
  if (!mirrorPath.startsWith(`${albumId}/`)) {
    return NextResponse.json({ error: 'mirror_path must be scoped to album' }, { status: 400, headers: NO_STORE })
  }
  if (!mirrorUrl || !mirrorUrl.startsWith('https://')) {
    return NextResponse.json({ error: 'mirror_url must be a non-empty https URL' }, { status: 400, headers: NO_STORE })
  }

  // Verify the URL points at our configured R2 host so we can't be tricked into linking the
  // download button at an external address.
  const ctx = getCloudflareContext()
  const env = ctx?.env as R2Env | undefined
  const publicHost = env?.R2_PUBLIC_HOST ?? process.env.R2_PUBLIC_HOST
  if (publicHost && !mirrorUrl.startsWith(`https://${publicHost}/`)) {
    return NextResponse.json({ error: 'mirror_url must point to the configured R2 host' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('photos')
    .update({ mirror_path: mirrorPath, mirror_url: mirrorUrl })
    .eq('album_id', albumId)
    .eq('storage_path', storagePath)
    .eq('storage_backend', 'stream')
    .is('mirror_path', null)

  if (error) {
    // If the migration hasn't been applied yet, the column doesn't exist. Don't blow up the
    // background mirror job — Stream playback still works, the download feature just won't be
    // available until the migration lands.
    const message = error.message ?? ''
    if (/mirror_path|mirror_url|column .* does not exist/i.test(message)) {
      return NextResponse.json({ ok: true, mirrored: false, reason: 'column-missing' }, { headers: NO_STORE })
    }
    console.error('[photo/mirror] update failed:', message)
    return NextResponse.json({ error: 'Could not attach mirror' }, { status: 500, headers: NO_STORE })
  }

  // Delete from Cloudflare Stream now that R2 has the permanent copy.
  // Stream is used only as an upload relay — R2 is the authoritative store.
  // storage_path format for stream videos: "{albumId}/{streamUid}.stream"
  const streamFilename = storagePath.split('/').pop() ?? ''
  const streamUid = streamFilename.endsWith('.stream')
    ? streamFilename.slice(0, -7)
    : ''
  if (streamUid) {
    deleteStreamVideo(streamUid).catch((e) =>
      console.error('[photo/mirror] Stream delete failed (non-fatal):', streamUid, e instanceof Error ? e.message : e),
    )
  }

  return NextResponse.json({ ok: true, mirrored: true }, { headers: NO_STORE })
}

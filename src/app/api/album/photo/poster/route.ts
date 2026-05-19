import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import type { R2Env } from '@/lib/r2'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Background poster patcher. Called by UploadZone AFTER a video is uploaded + its row exists.
// The browser generates a poster JPEG, uploads it to R2 via the existing /api/upload/r2 route
// with kind='poster', then calls THIS route to attach the poster_path/poster_url to the row.
//
// Auth model: same guest-friendly approach as the upload endpoints — no owner_token. The call
// is scoped by storage_path's required album-id prefix, and the "poster_path IS NULL" filter
// blocks any overwrite or replay attempt.
export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: {
    album_id?: string
    storage_path?: string
    poster_path?: string
    poster_url?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const albumId = String(body.album_id ?? '').trim()
  const storagePath = String(body.storage_path ?? '').trim()
  const posterPath = String(body.poster_path ?? '').trim()
  const posterUrl = String(body.poster_url ?? '').trim()

  if (!UUID_RE.test(albumId)) {
    return NextResponse.json({ error: 'Invalid album_id' }, { status: 400, headers: NO_STORE })
  }
  if (!storagePath.startsWith(`${albumId}/`)) {
    return NextResponse.json({ error: 'storage_path must be scoped to album' }, { status: 400, headers: NO_STORE })
  }
  if (!posterPath.startsWith(`${albumId}/`)) {
    return NextResponse.json({ error: 'poster_path must be scoped to album' }, { status: 400, headers: NO_STORE })
  }
  if (!posterUrl || !posterUrl.startsWith('https://')) {
    return NextResponse.json({ error: 'poster_url must be a non-empty https URL' }, { status: 400, headers: NO_STORE })
  }

  // Confirm the poster URL actually points at our configured R2 public host. Without this,
  // a caller could submit any external URL and we'd happily attach it to the album's display.
  const ctx = getCloudflareContext()
  const env = ctx?.env as R2Env | undefined
  const publicHost = env?.R2_PUBLIC_HOST ?? process.env.R2_PUBLIC_HOST
  if (publicHost && !posterUrl.startsWith(`https://${publicHost}/`)) {
    return NextResponse.json({ error: 'poster_url must point to the configured R2 host' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('photos')
    .update({ poster_path: posterPath, poster_url: posterUrl })
    .eq('album_id', albumId)
    .eq('storage_path', storagePath)
    .eq('media_type', 'video')
    .is('poster_path', null)

  if (error) {
    console.error('[photo/poster] update failed:', error.message)
    return NextResponse.json({ error: 'Could not attach poster' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}

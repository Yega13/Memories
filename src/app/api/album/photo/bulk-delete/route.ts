import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { R2Env } from '@/lib/r2'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyAlbumOwnerAccess } from '@/lib/album-owner-access'
import { deleteFaces } from '@/lib/rekognition'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_BATCH = 200
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type PhotoRow = {
  id: string
  album_id: string
  storage_path: string
  storage_backend: 'supabase' | 'r2'
  poster_path: string | null
  face_ids: string[] | null
}

// Deletes up to MAX_BATCH photos in a single request. Replaces N parallel calls to
// /api/album/photo/delete — one auth check, batched storage deletes, single DB delete.
export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: { slug?: string; owner_token?: string; photo_ids?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const token = String(body.owner_token ?? '').trim()
  const rawIds = Array.isArray(body.photo_ids) ? body.photo_ids : []
  const photoIds = rawIds
    .map((id) => String(id ?? '').trim())
    .filter((id) => UUID_RE.test(id))
    .slice(0, MAX_BATCH)

  if (!slug || !token || photoIds.length === 0) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyAlbumOwnerAccess(slug, token)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: photos, error: lookupError } = await admin
    .from('photos')
    .select('id, album_id, storage_path, storage_backend, poster_path, face_ids')
    .in('id', photoIds)
    .eq('album_id', access.album.id)
    .returns<PhotoRow[]>()

  if (lookupError) {
    console.error('[photo/bulk-delete] lookup failed:', lookupError.message)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500, headers: NO_STORE })
  }
  if (!photos || photos.length === 0) {
    return NextResponse.json({ deleted: 0 }, { headers: NO_STORE })
  }

  const r2Paths: string[] = []
  const supabasePaths: string[] = []
  const faceIds: string[] = []
  for (const p of photos) {
    const target = p.storage_backend === 'r2' ? r2Paths : supabasePaths
    target.push(p.storage_path)
    if (p.poster_path) target.push(p.poster_path)
    if (p.face_ids && p.face_ids.length > 0) faceIds.push(...p.face_ids)
  }

  // Storage cleanup — best-effort, never block the DB delete.
  if (r2Paths.length > 0) {
    const ctx = getCloudflareContext()
    const bucket = (ctx?.env as R2Env | undefined)?.R2_VIDEOS
    if (bucket) {
      try { await bucket.delete(r2Paths) } catch (e) { console.error('[photo/bulk-delete] R2 remove failed:', e) }
    }
  }
  if (supabasePaths.length > 0) {
    const { error: storageError } = await admin.storage.from('Photos').remove(supabasePaths)
    if (storageError) console.error('[photo/bulk-delete] storage remove failed:', storageError.message)
  }

  const ids = photos.map((p) => p.id)
  const { error: dbError } = await admin.from('photos').delete().in('id', ids)
  if (dbError) {
    console.error('[photo/bulk-delete] DB delete failed:', dbError.message)
    return NextResponse.json({ error: 'Delete failed' }, { status: 500, headers: NO_STORE })
  }

  // Clear cover_photo_id if the album's cover was in this batch.
  await admin.from('albums').update({ cover_photo_id: null }).eq('id', access.album.id).in('cover_photo_id', ids)

  if (faceIds.length > 0) {
    try {
      await deleteFaces(access.album.id, faceIds)
    } catch (e) {
      console.error('[photo/bulk-delete] Rekognition deleteFaces failed:', e instanceof Error ? e.message : String(e))
    }
  }

  return NextResponse.json({ deleted: ids.length }, { headers: NO_STORE })
}

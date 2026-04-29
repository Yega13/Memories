import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { R2Env } from '@/lib/r2'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Owner-gated photo deletion. Verifies the (slug, owner_token) pair against
// the albums table, then removes the photo from both storage and the photos
// table using the service-role client. The DELETE policy on `photos` is now
// closed, so this endpoint is the only path to deletion.
export async function POST(req: Request) {
  let body: { slug?: string; owner_token?: string; photo_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const token = String(body.owner_token ?? '').trim()
  const photoId = String(body.photo_id ?? '').trim()

  if (!slug || !token || !photoId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()

  // 1. Resolve album and verify ownership.
  const { data: album, error: albumError } = await admin
    .from('albums')
    .select('id, owner_token')
    .eq('slug', slug)
    .maybeSingle<{ id: string; owner_token: string }>()

  if (albumError || !album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if (!timingSafeEqual(token, album.owner_token)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }

  // 2. Look up the photo and confirm it belongs to this album. This stops
  // an owner of one album from deleting photos in another.
  const { data: photo, error: photoError } = await admin
    .from('photos')
    .select('id, album_id, storage_path, storage_backend, poster_path')
    .eq('id', photoId)
    .maybeSingle<{
      id: string
      album_id: string
      storage_path: string
      storage_backend: 'supabase' | 'r2'
      poster_path: string | null
    }>()

  if (photoError || !photo) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404, headers: NO_STORE })
  }
  if (photo.album_id !== album.id) {
    return NextResponse.json({ error: 'Photo does not belong to this album' }, { status: 403, headers: NO_STORE })
  }

  // 3. Delete from storage first, then DB. If storage fails we still try the
  // DB delete — an orphan storage object is recoverable; an orphan DB row is
  // a UI bug. Both errors are logged for observability.
  // Posters live in the same backend as their video (we upload them together).
  const paths = [photo.storage_path]
  if (photo.poster_path) paths.push(photo.poster_path)

  if (photo.storage_backend === 'r2') {
    const ctx = getCloudflareContext()
    const bucket = (ctx?.env as R2Env | undefined)?.R2_VIDEOS
    if (bucket) {
      try {
        await bucket.delete(paths)
      } catch (e) {
        console.error('[photo/delete] R2 remove failed:', e)
      }
    } else {
      console.error('[photo/delete] R2 binding unavailable; orphaning', paths)
    }
  } else {
    const { error: storageError } = await admin.storage.from('Photos').remove(paths)
    if (storageError) {
      console.error('[photo/delete] storage remove failed:', storageError.message)
    }
  }

  const { error: dbError } = await admin.from('photos').delete().eq('id', photoId)
  if (dbError) {
    console.error('[photo/delete] DB delete failed:', dbError.message)
    return NextResponse.json({ error: 'Could not delete photo' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

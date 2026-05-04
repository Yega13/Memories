import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { timingSafeEqual } from '@/lib/timing-safe'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  let body: { slug?: string; owner_token?: string; photo_ids?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const token = String(body.owner_token ?? '').trim()
  const photoIds = Array.isArray(body.photo_ids) ? body.photo_ids.map((id) => String(id).trim()).filter(Boolean) : []
  if (!slug || !token || photoIds.length === 0) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_STORE })
  }
  if (new Set(photoIds).size !== photoIds.length) {
    return NextResponse.json({ error: 'Duplicate media ids' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()
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

  const { data: albumPhotos, error: photoError } = await admin
    .from('photos')
    .select('id')
    .eq('album_id', album.id)
    .returns<Array<{ id: string }>>()

  if (photoError) {
    console.error('[photos/reorder] lookup failed:', photoError.message)
    return NextResponse.json({ error: 'Could not load media' }, { status: 500, headers: NO_STORE })
  }

  const albumPhotoIds = new Set((albumPhotos ?? []).map((photo) => photo.id))
  if (photoIds.length !== albumPhotoIds.size || photoIds.some((id) => !albumPhotoIds.has(id))) {
    return NextResponse.json({ error: 'Order must include every media item in this album' }, { status: 400, headers: NO_STORE })
  }

  for (let index = 0; index < photoIds.length; index++) {
    const { error } = await admin
      .from('photos')
      .update({ sort_order: index })
      .eq('id', photoIds[index])
      .eq('album_id', album.id)
    if (error) {
      console.error('[photos/reorder] update failed:', error.message)
      return NextResponse.json({ error: 'Could not save media order' }, { status: 500, headers: NO_STORE })
    }
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}

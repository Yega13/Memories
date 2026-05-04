import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { clampMediaRadius, isMediaDisplayFilter, type MediaDisplayFilter } from '@/lib/media-display'
import { timingSafeEqual } from '@/lib/timing-safe'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: {
    slug?: string
    owner_token?: string
    photo_id?: string
    display_radius?: number | null
    display_filter?: MediaDisplayFilter | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const token = String(body.owner_token ?? '').trim()
  const photoId = String(body.photo_id ?? '').trim()
  const displayRadius = body.display_radius == null ? null : clampMediaRadius(body.display_radius)
  const displayFilter = body.display_filter == null
    ? null
    : isMediaDisplayFilter(body.display_filter)
      ? body.display_filter
      : undefined

  if (!slug || !token || !photoId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_STORE })
  }
  if (body.display_radius != null && displayRadius == null) {
    return NextResponse.json({ error: 'Invalid border radius' }, { status: 400, headers: NO_STORE })
  }
  if (displayFilter === undefined) {
    return NextResponse.json({ error: 'Invalid filter' }, { status: 400, headers: NO_STORE })
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

  const { data: photo, error: photoError } = await admin
    .from('photos')
    .select('id, album_id')
    .eq('id', photoId)
    .maybeSingle<{ id: string; album_id: string }>()

  if (photoError || !photo) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404, headers: NO_STORE })
  }
  if (photo.album_id !== album.id) {
    return NextResponse.json({ error: 'Photo does not belong to this album' }, { status: 403, headers: NO_STORE })
  }

  const { data: updated, error } = await admin
    .from('photos')
    .update({ display_radius: displayRadius, display_filter: displayFilter })
    .eq('id', photo.id)
    .select('display_radius, display_filter')
    .single<{ display_radius: number | null; display_filter: MediaDisplayFilter | null }>()

  if (error) {
    console.error('[photo/settings] update failed:', error.message)
    return NextResponse.json({ error: 'Could not save photo settings' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, ...updated }, { headers: NO_STORE })
}

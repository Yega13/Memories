import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { MediaDisplayFilter } from '@/lib/supabase'
import { timingSafeEqual } from '@/lib/timing-safe'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const MIN_RADIUS = 0
const MAX_RADIUS = 999
const FILTERS = new Set<MediaDisplayFilter>(['none', 'warm', 'cool', 'mono', 'vintage', 'soft'])

export async function POST(req: Request) {
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
  const displayRadius = body.display_radius == null ? null : clampRadius(body.display_radius)
  const displayFilter = body.display_filter == null
    ? null
    : FILTERS.has(body.display_filter)
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
    .single<{ display_radius: number | null; display_filter: MediaDisplayFilter }>()

  if (error) {
    console.error('[photo/settings] update failed:', error.message)
    return NextResponse.json({ error: 'Could not save photo settings' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, ...updated }, { headers: NO_STORE })
}

function clampRadius(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.max(MIN_RADIUS, Math.min(MAX_RADIUS, Math.round(numeric)))
}

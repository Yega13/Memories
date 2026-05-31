import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { clampMediaRadius, isMediaDisplayFilter, type MediaDisplayFilter } from '@/lib/media-display'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { MEDIA_AUTHOR_MAX, MEDIA_CAPTION_MAX, mediaTextOrNull } from '@/lib/media-text'
import { verifyOwnerViaCookie } from '@/lib/album-owner-access'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: {
    slug?: string
    photo_id?: string
    display_radius?: number | null
    display_filter?: MediaDisplayFilter | null
    caption?: string | null
    author_name?: string | null
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const photoId = String(body.photo_id ?? '').trim()
  const displayRadius = body.display_radius == null ? null : clampMediaRadius(body.display_radius)
  const displayFilter = body.display_filter == null
    ? null
    : isMediaDisplayFilter(body.display_filter)
      ? body.display_filter
      : undefined
  const hasCaption = Object.prototype.hasOwnProperty.call(body, 'caption')
  const hasAuthorName = Object.prototype.hasOwnProperty.call(body, 'author_name')
  const caption = hasCaption ? mediaTextOrNull(body.caption, MEDIA_CAPTION_MAX) : undefined
  const authorName = hasAuthorName ? mediaTextOrNull(body.author_name, MEDIA_AUTHOR_MAX) : undefined

  if (!slug || !photoId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_STORE })
  }
  if (body.display_radius != null && displayRadius == null) {
    return NextResponse.json({ error: 'Invalid border radius' }, { status: 400, headers: NO_STORE })
  }
  if (displayFilter === undefined) {
    return NextResponse.json({ error: 'Invalid filter' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookie(slug)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: photo, error: photoError } = await admin
    .from('photos')
    .select('id, album_id')
    .eq('id', photoId)
    .maybeSingle<{ id: string; album_id: string }>()

  if (photoError || !photo) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404, headers: NO_STORE })
  }
  if (photo.album_id !== access.album.id) {
    return NextResponse.json({ error: 'Photo does not belong to this album' }, { status: 403, headers: NO_STORE })
  }

  const updatePayload: {
    display_radius: number | null
    display_filter: MediaDisplayFilter | null
    caption?: string | null
    author_name?: string | null
  } = {
    display_radius: displayRadius,
    display_filter: displayFilter,
  }
  if (hasCaption) updatePayload.caption = caption ?? null
  if (hasAuthorName) updatePayload.author_name = authorName ?? null

  const { data: updated, error } = await admin
    .from('photos')
    .update(updatePayload)
    .eq('id', photo.id)
    .select('display_radius, display_filter, caption, author_name')
    .single<{
      display_radius: number | null
      display_filter: MediaDisplayFilter | null
      caption: string | null
      author_name: string | null
    }>()

  if (error) {
    console.error('[photo/settings] update failed:', error.message)
    return NextResponse.json({ error: 'Could not save photo settings' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, ...updated }, { headers: NO_STORE })
}

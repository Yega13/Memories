import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyOwnerViaCookie } from '@/lib/album-owner-access'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: { slug?: string; photo_ids?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const photoIds = Array.isArray(body.photo_ids) ? body.photo_ids.map((id) => String(id).trim()).filter(Boolean) : []
  if (!slug || photoIds.length === 0) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_STORE })
  }
  if (new Set(photoIds).size !== photoIds.length) {
    return NextResponse.json({ error: 'Duplicate media ids' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookie(slug)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: albumPhotos, error: photoError } = await admin
    .from('photos')
    .select('id')
    .eq('album_id', access.album.id)
    .returns<Array<{ id: string }>>()

  if (photoError) {
    console.error('[photos/reorder] lookup failed:', photoError.message)
    return NextResponse.json({ error: 'Could not load media' }, { status: 500, headers: NO_STORE })
  }

  const albumPhotoIds = new Set((albumPhotos ?? []).map((photo) => photo.id))
  // Only update IDs that actually exist in this album; silently drop any that were deleted
  // concurrently (e.g. guest deleted their own photo while owner was dragging). Also drops
  // IDs that were uploaded by a guest after the owner opened arrange mode — those keep their
  // existing sort_order (null) and appear after the explicitly ordered items.
  const validIds = photoIds.filter((id) => albumPhotoIds.has(id))

  if (validIds.length === 0) {
    return NextResponse.json({ ok: true }, { headers: NO_STORE })
  }

  // Single atomic UPDATE via RPC — one round-trip, no partial-failure risk.
  // The function uses unnest() so the DB applies all sort_order values in one statement
  // and enforces album_id at the query level.
  const { error: rpcError } = await admin.rpc('batch_set_sort_order', {
    p_album_id: access.album.id,
    p_ids: validIds,
    p_orders: validIds.map((_, i) => i),
  })

  if (rpcError) {
    console.error('[photos/reorder] rpc failed:', rpcError.message)
    return NextResponse.json({ error: 'Could not save media order' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}

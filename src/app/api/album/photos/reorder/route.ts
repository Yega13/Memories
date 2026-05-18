import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyAlbumOwnerAccess } from '@/lib/album-owner-access'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

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

  const access = await verifyAlbumOwnerAccess(slug, token)
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
  if (photoIds.length !== albumPhotoIds.size || photoIds.some((id) => !albumPhotoIds.has(id))) {
    return NextResponse.json({ error: 'Order must include every media item in this album' }, { status: 400, headers: NO_STORE })
  }

  // Parallelize the per-row updates — sequentially this was ~50 ms × N round-trips, which made
  // reordering large albums feel laggy. Supabase handles a couple dozen concurrent updates fine.
  const results = await Promise.all(
    photoIds.map((id, index) =>
      admin
        .from('photos')
        .update({ sort_order: index })
        .eq('id', id)
        .eq('album_id', access.album.id),
    ),
  )
  const failure = results.find((r) => r.error)
  if (failure?.error) {
    console.error('[photos/reorder] update failed:', failure.error.message)
    return NextResponse.json({ error: 'Could not save media order' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}

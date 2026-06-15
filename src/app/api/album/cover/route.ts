import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyOwnerViaCookie } from '@/lib/album-owner-access'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: { slug?: string; photo_id?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const photoId = body.photo_id === null ? null : String(body.photo_id ?? '').trim() || null

  if (!slug) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookie(slug)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }

  const admin = createAdminClient()

  if (photoId !== null) {
    const { data: photo } = await admin
      .from('photos')
      .select('id, album_id')
      .eq('id', photoId)
      .maybeSingle<{ id: string; album_id: string }>()

    if (!photo || photo.album_id !== access.album.id) {
      return NextResponse.json({ error: 'Photo not found in this album' }, { status: 404, headers: NO_STORE })
    }
  }

  const { error } = await admin
    .from('albums')
    .update({ cover_photo_id: photoId })
    .eq('id', access.album.id)

  if (error) {
    return NextResponse.json({ error: 'Could not update cover' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, cover_photo_id: photoId }, { headers: NO_STORE })
}

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteAlbumAssetsAndRows } from '@/lib/album-delete'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyOwnerViaCookie } from '@/lib/album-owner-access'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

type AlbumToDelete = {
  id: string
  owner_token: string
  user_id: string | null
  background_theme: string | null
}

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: { slug?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  if (!slug) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookie<AlbumToDelete>(slug, 'background_theme')
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const album = access.album
  const result = await deleteAlbumAssetsAndRows(admin, album)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}

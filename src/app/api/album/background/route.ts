import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidAlbumBackground, normalizeAlbumBackground } from '@/lib/album-background'
import { timingSafeEqual } from '@/lib/timing-safe'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  let body: { slug?: string; owner_token?: string; background_theme?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const token = String(body.owner_token ?? '').trim()
  if (!slug || !token) {
    return NextResponse.json({ error: 'Missing slug or owner_token' }, { status: 400, headers: NO_STORE })
  }
  if (!isValidAlbumBackground(body.background_theme)) {
    return NextResponse.json({ error: 'Invalid background' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: album, error: lookupError } = await admin
    .from('albums')
    .select('id, owner_token')
    .eq('slug', slug)
    .maybeSingle<{ id: string; owner_token: string }>()

  if (lookupError || !album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if (!timingSafeEqual(token, album.owner_token)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }

  const background_theme = normalizeAlbumBackground(body.background_theme)
  const { error } = await admin
    .from('albums')
    .update({ background_theme })
    .eq('id', album.id)

  if (error) {
    console.error('[album/background] update failed:', error.message)
    return NextResponse.json({ error: 'Could not save background' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, background_theme }, { headers: NO_STORE })
}

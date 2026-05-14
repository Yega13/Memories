import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidAlbumBackground, normalizeAlbumBackground } from '@/lib/album-background'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyAlbumOwnerAccess } from '@/lib/album-owner-access'
import { storagePathFromPublicPhotoUrl } from '@/lib/storage-path'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

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

  const access = await verifyAlbumOwnerAccess<{ id: string; owner_token: string; user_id: string | null; custom_slug?: string | null; background_theme: string | null }>(slug, token, 'background_theme')
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const background_theme = normalizeAlbumBackground(body.background_theme)
  const { error } = await admin
    .from('albums')
    .update({ background_theme })
    .eq('id', access.album.id)

  if (error) {
    console.error('[album/background] update failed:', error.message)
    const isConstraintError = error.code === '23514' || error.message.includes('albums_background_theme_check')
    return NextResponse.json(
      {
        error: isConstraintError
          ? 'Database background constraint is outdated. Run the latest album background migration.'
          : 'Could not save background',
      },
      { status: 500, headers: NO_STORE },
    )
  }

  const previousPath = storagePathFromPublicPhotoUrl(access.album.background_theme)
  const nextPath = storagePathFromPublicPhotoUrl(background_theme)
  if (previousPath && previousPath !== nextPath) {
    const { error: removeError } = await admin.storage.from('Photos').remove([previousPath])
    if (removeError) console.error('[album/background] old background remove failed:', removeError.message)
  }

  return NextResponse.json({ ok: true, background_theme }, { headers: NO_STORE })
}

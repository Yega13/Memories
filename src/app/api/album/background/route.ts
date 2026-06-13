import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidAlbumBackground, normalizeAlbumBackground } from '@/lib/album-background'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyOwnerViaCookie } from '@/lib/album-owner-access'
import { storagePathFromPublicPhotoUrl, r2PathFromBackgroundTheme } from '@/lib/storage-path'
import type { R2Env } from '@/lib/r2'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: { slug?: string; background_theme?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  if (!slug) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (!isValidAlbumBackground(body.background_theme)) {
    return NextResponse.json({ error: 'Invalid background' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookie<{ id: string; owner_token: string; user_id: string | null; custom_slug?: string | null; background_theme: string | null }>(slug, 'background_theme')
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

  // If switching away from a custom image (to stock/color/null), delete the old background file
  const ctx = getCloudflareContext()
  const r2Env = ctx?.env as R2Env | undefined
  const publicHost = r2Env?.R2_PUBLIC_HOST ?? process.env.R2_PUBLIC_HOST ?? 'videos.hushare.space'

  const prevTheme = access.album.background_theme
  const prevR2Path = r2PathFromBackgroundTheme(prevTheme, publicHost)
  const prevSupabasePath = storagePathFromPublicPhotoUrl(prevTheme)
  const previousWasCustom = !!(prevR2Path || prevSupabasePath)

  const nextIsCustom = !!(r2PathFromBackgroundTheme(background_theme, publicHost) || storagePathFromPublicPhotoUrl(background_theme))

  if (previousWasCustom && !nextIsCustom) {
    // Delete R2-backed background
    if (prevR2Path && r2Env?.R2_VIDEOS) {
      r2Env.R2_VIDEOS.delete([prevR2Path]).catch((e) =>
        console.error('[album/background] R2 background cleanup failed:', e instanceof Error ? e.message : e),
      )
    }
    // Delete legacy Supabase-backed background (best-effort; may fail on new project)
    if (prevSupabasePath) {
      try {
        const folder = `${access.album.id}/backgrounds`
        const { data: existing } = await admin.storage.from('Photos').list(folder)
        if (existing && existing.length > 0) {
          const toDelete = existing.map((f) => `${folder}/${f.name}`)
          const { error: rmErr } = await admin.storage.from('Photos').remove(toDelete)
          if (rmErr) console.error('[album/background] Supabase background remove failed:', rmErr.message)
        }
      } catch (err) {
        console.error('[album/background] Supabase background cleanup failed:', err instanceof Error ? err.message : String(err))
      }
    }
  }

  return NextResponse.json({ ok: true, background_theme }, { headers: NO_STORE })
}

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyOwnerViaCookie } from '@/lib/album-owner-access'
import { r2PathFromBackgroundTheme } from '@/lib/storage-path'
import type { R2Env } from '@/lib/r2'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_BACKGROUND_BYTES = 10 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
}

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(form.get('slug') ?? '').trim()
  const file = form.get('file')

  if (!slug || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_STORE })
  }
  if (file.size > MAX_BACKGROUND_BYTES) {
    return NextResponse.json({ error: 'Background image must be 10 MB or smaller' }, { status: 413, headers: NO_STORE })
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Use a JPG, PNG, WebP, or AVIF image' }, { status: 415, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookie<{ id: string; owner_token: string; user_id: string | null; custom_slug?: string | null; background_theme: string | null }>(slug, 'background_theme')
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }

  const ctx = getCloudflareContext()
  const env = ctx?.env as R2Env | undefined
  const r2 = env?.R2_VIDEOS
  const publicHost = env?.R2_PUBLIC_HOST ?? process.env.R2_PUBLIC_HOST ?? 'videos.hushare.space'

  if (!r2) {
    console.error('[album/background/upload] R2_VIDEOS binding not available')
    return NextResponse.json({ error: 'Storage not configured' }, { status: 500, headers: NO_STORE })
  }

  const ext = EXT_BY_TYPE[file.type]
  const path = `${access.album.id}/backgrounds/${randomUUID()}.${ext}`

  try {
    await r2.put(path, file, {
      httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000' },
    })
  } catch (err) {
    console.error('[album/background/upload] R2 upload failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not upload background' }, { status: 500, headers: NO_STORE })
  }

  const publicUrl = `https://${publicHost}/${path}`
  const background_theme = `image:${publicUrl}`

  const admin = createAdminClient()
  const { error: updateError } = await admin
    .from('albums')
    .update({ background_theme })
    .eq('id', access.album.id)

  if (updateError) {
    console.error('[album/background/upload] album update failed:', updateError.message)
    r2.delete([path]).catch((e) => console.error('[album/background/upload] R2 rollback failed:', e))
    return NextResponse.json({ error: 'Could not save background' }, { status: 500, headers: NO_STORE })
  }

  // Delete the previous background file from R2 (best-effort)
  const oldPath = r2PathFromBackgroundTheme(access.album.background_theme, publicHost)
  if (oldPath && oldPath !== path) {
    r2.delete([oldPath]).catch((e) =>
      console.error('[album/background/upload] old background cleanup failed:', e),
    )
  }

  return NextResponse.json({ ok: true, background_theme }, { headers: NO_STORE })
}

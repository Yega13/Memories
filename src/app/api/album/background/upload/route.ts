import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyAlbumOwnerAccess } from '@/lib/album-owner-access'

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
  const token = String(form.get('owner_token') ?? '').trim()
  const file = form.get('file')

  if (!slug || !token || !(file instanceof Blob)) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_STORE })
  }
  if (file.size > MAX_BACKGROUND_BYTES) {
    return NextResponse.json({ error: 'Background image must be 10 MB or smaller' }, { status: 413, headers: NO_STORE })
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Use a JPG, PNG, WebP, or AVIF image' }, { status: 415, headers: NO_STORE })
  }

  const access = await verifyAlbumOwnerAccess(slug, token)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const ext = EXT_BY_TYPE[file.type]
  const path = `${access.album.id}/backgrounds/${randomUUID()}.${ext}`
  const { error: uploadError } = await admin.storage
    .from('Photos')
    .upload(path, file, { contentType: file.type, cacheControl: '31536000', upsert: false })

  if (uploadError) {
    console.error('[album/background/upload] storage upload failed:', uploadError.message)
    return NextResponse.json({ error: 'Could not upload background' }, { status: 500, headers: NO_STORE })
  }

  const publicUrl = admin.storage.from('Photos').getPublicUrl(path).data.publicUrl
  const background_theme = `image:${publicUrl}`
  const { error: updateError } = await admin
    .from('albums')
    .update({ background_theme })
    .eq('id', access.album.id)

  if (updateError) {
    console.error('[album/background/upload] album update failed:', updateError.message)
    await admin.storage.from('Photos').remove([path])
    return NextResponse.json({ error: 'Could not save background' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, background_theme }, { headers: NO_STORE })
}

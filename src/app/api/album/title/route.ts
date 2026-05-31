import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyOwnerWithRateLimit } from '@/lib/album-owner-access'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_TITLE_LENGTH = 120

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: { slug?: string; owner_token?: string; title?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const token = String(body.owner_token ?? '').trim()
  const title = String(body.title ?? '').trim().slice(0, MAX_TITLE_LENGTH)
  if (!slug || !token || !title) {
    return NextResponse.json({ error: 'Album title is required' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerWithRateLimit(req, slug, token)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: updated, error } = await admin
    .from('albums')
    .update({ title })
    .eq('id', access.album.id)
    .select('title')
    .single<{ title: string }>()

  if (error) {
    console.error('[album/title] update failed:', error.message)
    return NextResponse.json({ error: 'Could not rename album' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, title: updated.title }, { headers: NO_STORE })
}

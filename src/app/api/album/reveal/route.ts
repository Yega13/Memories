import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyAlbumOwnerAccess } from '@/lib/album-owner-access'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: { slug?: string; owner_token?: string; reveal_at?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const token = String(body.owner_token ?? '').trim()
  const rawRevealAt = body.reveal_at

  if (!slug || !token) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_STORE })
  }

  // null clears the reveal; otherwise validate it's a parseable date
  let revealAt: string | null = null
  if (rawRevealAt != null && rawRevealAt !== '') {
    const parsed = new Date(rawRevealAt)
    if (isNaN(parsed.getTime())) {
      return NextResponse.json({ error: 'Invalid reveal_at date' }, { status: 400, headers: NO_STORE })
    }
    revealAt = parsed.toISOString()
  }

  const access = await verifyAlbumOwnerAccess(slug, token)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('albums')
    .update({ reveal_at: revealAt })
    .eq('id', access.album.id)

  if (error) {
    return NextResponse.json({ error: 'Could not update reveal time' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, reveal_at: revealAt }, { headers: NO_STORE })
}

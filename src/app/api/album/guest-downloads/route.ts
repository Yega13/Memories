import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyOwnerViaCookieWithRateLimit } from '@/lib/album-owner-access'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: { slug?: string; allow_guest_downloads?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  if (!slug) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }
  if (typeof body.allow_guest_downloads !== 'boolean') {
    return NextResponse.json({ error: 'allow_guest_downloads must be a boolean' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookieWithRateLimit(req, slug)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('albums')
    .update({ allow_guest_downloads: body.allow_guest_downloads })
    .eq('id', access.album.id)

  if (error) {
    console.error('[album/guest-downloads] update failed:', error.message)
    return NextResponse.json({ error: 'Could not save setting' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, allow_guest_downloads: body.allow_guest_downloads }, { headers: NO_STORE })
}

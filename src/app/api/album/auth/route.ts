import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { timingSafeEqual } from '@/lib/timing-safe'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Confirms whether a (slug, owner_token) pair is the real owner of an album.
// We do this server-side so the owner_token never has to be returned to
// the browser. The result is just a boolean - leak-free even on misuse.
export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: { slug?: string; owner_token?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const token = String(body.owner_token ?? '').trim()

  // Anything missing -> not an owner. We don't echo why; saves a tiny bit
  // of probing surface.
  if (!slug || !token) {
    return NextResponse.json({ isOwner: false }, { headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('albums')
    .select('id, owner_token, user_id')
    .eq('slug', slug)
    .maybeSingle<{ id: string; owner_token: string; user_id: string | null }>()

  if (error || !data) {
    return NextResponse.json({ isOwner: false }, { headers: NO_STORE })
  }

  const isOwner = timingSafeEqual(token, data.owner_token)
  if (isOwner && !data.user_id) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      await admin.from('albums').update({ user_id: user.id }).eq('id', data.id).is('user_id', null)
    }
  }

  return NextResponse.json({ isOwner }, { headers: NO_STORE })
}

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

// Confirms whether a (slug, owner_token) pair is the real owner of an album.
// We do this server-side so the owner_token never has to be returned to
// the browser. The result is just a boolean — leak-free even on misuse.
export async function POST(req: Request) {
  let body: { slug?: string; owner_token?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const token = String(body.owner_token ?? '').trim()

  // Anything missing → not an owner. We don't echo why; saves a tiny bit
  // of probing surface.
  if (!slug || !token) {
    return NextResponse.json({ isOwner: false }, { headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('albums')
    .select('owner_token')
    .eq('slug', slug)
    .maybeSingle<{ owner_token: string }>()

  if (error || !data) {
    return NextResponse.json({ isOwner: false }, { headers: NO_STORE })
  }

  const isOwner = timingSafeEqual(token, data.owner_token)
  return NextResponse.json({ isOwner }, { headers: NO_STORE })
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

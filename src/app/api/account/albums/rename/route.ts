import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAccountAdmin } from '@/lib/auth'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_TITLE_LENGTH = 120

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: { album_id?: string; title?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const albumId = String(body.album_id ?? '').trim()
  const title = String(body.title ?? '').trim().slice(0, MAX_TITLE_LENGTH)
  if (!albumId || !title) {
    return NextResponse.json({ error: 'Album title is required' }, { status: 400, headers: NO_STORE })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Sign in to rename albums' }, { status: 401, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: album, error: lookupError } = await admin
    .from('albums')
    .select('id, user_id')
    .eq('id', albumId)
    .maybeSingle<{ id: string; user_id: string | null }>()

  if (lookupError || !album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if (album.user_id !== user.id && !isAccountAdmin(user)) {
    return NextResponse.json({ error: "You don't have access" }, { status: 403, headers: NO_STORE })
  }

  const { data: updated, error } = await admin
    .from('albums')
    .update({ title })
    .eq('id', album.id)
    .select('title')
    .single<{ title: string }>()

  if (error) {
    console.error('[account/albums/rename] update failed:', error.message)
    return NextResponse.json({ error: 'Could not rename album' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, title: updated.title }, { headers: NO_STORE })
}

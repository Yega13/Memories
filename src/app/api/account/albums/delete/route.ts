import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteAlbumAssetsAndRows } from '@/lib/album-delete'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  let body: { album_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const albumId = String(body.album_id ?? '').trim()
  if (!albumId) {
    return NextResponse.json({ error: 'Missing album_id' }, { status: 400, headers: NO_STORE })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: album, error: albumError } = await admin
    .from('albums')
    .select('id, user_id, background_theme')
    .eq('id', albumId)
    .maybeSingle<{ id: string; user_id: string | null; background_theme: string | null }>()

  if (albumError || !album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if (album.user_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }

  const result = await deleteAlbumAssetsAndRows(admin, album)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}

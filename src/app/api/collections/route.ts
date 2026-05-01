import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireTier } from '@/lib/subscriptions'
import { validateCustomSlug } from '@/lib/custom-slug'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  let body: { slug?: string; owner_token?: string; name?: string; collection_slug?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const albumSlug = String(body.slug ?? '').trim()
  const token = String(body.owner_token ?? '').trim()
  const name = String(body.name ?? '').trim().slice(0, 80)
  const rawCollectionSlug = String(body.collection_slug ?? slugFromName(name)).trim()
  if (!albumSlug || !token || !name) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_STORE })
  }

  const validation = validateCustomSlug(rawCollectionSlug)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400, headers: NO_STORE })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Sign in to create a collection' }, { status: 401, headers: NO_STORE })
  }
  const gate = await requireTier(user, 'studio')
  if (gate) {
    return NextResponse.json({ error: 'Studio plan required' }, { status: 403, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: album, error: albumError } = await admin
    .from('albums')
    .select('id, owner_token, user_id')
    .eq('slug', albumSlug)
    .maybeSingle<{ id: string; owner_token: string; user_id: string | null }>()

  if (albumError || !album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if (!timingSafeEqual(token, album.owner_token)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }

  if (album.user_id && album.user_id !== user.id) {
    return NextResponse.json({ error: 'This album is bound to another account' }, { status: 403, headers: NO_STORE })
  }

  const { data: collection, error: collectionError } = await admin
    .from('collections')
    .insert({
      user_id: user.id,
      name,
      slug: validation.slug,
    })
    .select('id, slug, name')
    .single<{ id: string; slug: string; name: string }>()

  if (collectionError) {
    if ((collectionError as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'That collection URL is already taken' }, { status: 409, headers: NO_STORE })
    }
    console.error('[collections] create failed:', collectionError.message)
    return NextResponse.json({ error: 'Could not create collection' }, { status: 500, headers: NO_STORE })
  }

  await admin.from('albums').update({ user_id: user.id }).eq('id', album.id).is('user_id', null)

  const { error: linkError } = await admin
    .from('collection_albums')
    .upsert(
      { collection_id: collection.id, album_id: album.id, sort_order: 0 },
      { onConflict: 'collection_id,album_id' },
    )

  if (linkError) {
    console.error('[collections] link failed:', linkError.message)
    return NextResponse.json({ error: 'Collection created, but album could not be added' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true, collection }, { headers: NO_STORE })
}

function slugFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'collection'
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

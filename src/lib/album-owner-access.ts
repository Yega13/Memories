import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { isAccountAdmin } from '@/lib/auth'
import { timingSafeEqual } from '@/lib/timing-safe'

type AlbumOwnerBase = {
  id: string
  owner_token: string
  user_id: string | null
}

type AccessOk<T extends AlbumOwnerBase> = {
  ok: true
  album: T
  userId: string | null
}

type AccessFail = {
  ok: false
  status: number
  error: string
  reason: 'missing' | 'not_found' | 'bad_token' | 'access_denied'
}

export async function verifyAlbumOwnerAccess<T extends AlbumOwnerBase = AlbumOwnerBase>(
  slug: string,
  ownerToken: string,
  extraColumns = '',
): Promise<AccessOk<T> | AccessFail> {
  const cleanSlug = slug.trim()
  const cleanToken = ownerToken.trim()
  if (!cleanSlug || !cleanToken) {
    return { ok: false, status: 400, error: 'Missing slug or owner_token', reason: 'missing' }
  }

  const admin = createAdminClient()
  const columns = ['id', 'owner_token', 'user_id', extraColumns].filter(Boolean).join(', ')
  const { data: album, error } = await admin
    .from('albums')
    .select(columns)
    .eq('slug', cleanSlug)
    .maybeSingle<T>()

  if (error || !album) {
    return { ok: false, status: 404, error: 'Album not found', reason: 'not_found' }
  }
  if (!timingSafeEqual(cleanToken, album.owner_token)) {
    return { ok: false, status: 403, error: 'Forbidden', reason: 'bad_token' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (album.user_id) {
    if (!user || (user.id !== album.user_id && !isAccountAdmin(user))) {
      return { ok: false, status: 403, error: "You don't have access", reason: 'access_denied' }
    }
    return { ok: true, album, userId: user.id }
  }

  if (user) {
    await admin.from('albums').update({ user_id: user.id }).eq('id', album.id).is('user_id', null)
  }

  return { ok: true, album, userId: user?.id ?? null }
}

import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createAdminClient } from '@/lib/supabase/admin'
import type { R2Env } from '@/lib/r2'
import { timingSafeEqual } from '@/lib/timing-safe'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

type AlbumToDelete = {
  id: string
  owner_token: string
  background_theme: string | null
}

type PhotoToDelete = {
  storage_path: string
  storage_backend: 'supabase' | 'r2'
  poster_path: string | null
}

export async function POST(req: Request) {
  let body: { slug?: string; owner_token?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const token = String(body.owner_token ?? '').trim()
  if (!slug || !token) {
    return NextResponse.json({ error: 'Missing slug or owner_token' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: album, error: albumError } = await admin
    .from('albums')
    .select('id, owner_token, background_theme')
    .eq('slug', slug)
    .maybeSingle<AlbumToDelete>()

  if (albumError || !album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if (!timingSafeEqual(token, album.owner_token)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE })
  }

  const { data: photos, error: photosError } = await admin
    .from('photos')
    .select('storage_path, storage_backend, poster_path')
    .eq('album_id', album.id)
    .returns<PhotoToDelete[]>()

  if (photosError) {
    console.error('[album/delete] photo lookup failed:', photosError.message)
    return NextResponse.json({ error: 'Could not prepare album deletion' }, { status: 500, headers: NO_STORE })
  }

  const supabasePaths = new Set<string>()
  const r2Paths = new Set<string>()
  for (const photo of photos ?? []) {
    const target = photo.storage_backend === 'r2' ? r2Paths : supabasePaths
    target.add(photo.storage_path)
    if (photo.poster_path) target.add(photo.poster_path)
  }

  const backgroundPath = storagePathFromPublicPhotoUrl(album.background_theme)
  if (backgroundPath) supabasePaths.add(backgroundPath)

  if (r2Paths.size > 0) {
    const ctx = getCloudflareContext()
    const bucket = (ctx?.env as R2Env | undefined)?.R2_VIDEOS
    if (bucket) {
      try {
        await bucket.delete([...r2Paths])
      } catch (e) {
        console.error('[album/delete] R2 remove failed:', e)
      }
    } else {
      console.error('[album/delete] R2 binding unavailable; orphaning', [...r2Paths])
    }
  }

  if (supabasePaths.size > 0) {
    const { error: storageError } = await admin.storage.from('Photos').remove([...supabasePaths])
    if (storageError) console.error('[album/delete] storage remove failed:', storageError.message)
  }

  await admin.from('collection_albums').delete().eq('album_id', album.id)
  await admin.from('photos').delete().eq('album_id', album.id)

  const { error: deleteError } = await admin.from('albums').delete().eq('id', album.id)
  if (deleteError) {
    console.error('[album/delete] DB delete failed:', deleteError.message)
    return NextResponse.json({ error: 'Could not delete album' }, { status: 500, headers: NO_STORE })
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}

function storagePathFromPublicPhotoUrl(value: string | null): string | null {
  if (!value?.startsWith('image:')) return null
  const marker = '/storage/v1/object/public/Photos/'
  const markerIndex = value.indexOf(marker)
  if (markerIndex === -1) return null
  const path = value.slice(markerIndex + marker.length).split('?')[0]
  return path ? decodeURIComponent(path) : null
}

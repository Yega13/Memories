import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { MEDIA_AUTHOR_MAX, MEDIA_CAPTION_MAX, mediaTextOrNull } from '@/lib/media-text'
import { sendPhotoNotificationEmail } from '@/lib/email'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

type PhotoRow = {
  storage_path?: string
  storage_backend?: 'supabase' | 'r2'
  url?: string
  caption?: string | null
  author_name?: string | null
  media_type?: 'image' | 'video'
  poster_path?: string | null
  poster_url?: string | null
  duration_seconds?: number | null
}

const STORAGE_BACKENDS = new Set(['supabase', 'r2'])
const MEDIA_TYPES = new Set(['image', 'video'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: { album_id?: string; photos?: PhotoRow[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const albumId = String(body.album_id ?? '').trim()
  const rows = Array.isArray(body.photos) ? body.photos.slice(0, 100) : []
  if (!UUID_RE.test(albumId) || rows.length === 0) {
    return NextResponse.json({ error: 'Missing album or photos' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: album } = await admin
    .from('albums')
    .select('id, user_id, title, slug, custom_slug, last_notification_at')
    .eq('id', albumId)
    .maybeSingle<{ id: string; user_id: string | null; title: string; slug: string; custom_slug: string | null; last_notification_at: string | null }>()
  if (!album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }

  const shaped = rows.map((row) => shapePhotoRow(albumId, row))
  if (shaped.some((row) => !row)) {
    return NextResponse.json({ error: 'Invalid photo details' }, { status: 400, headers: NO_STORE })
  }

  const { error } = await admin.from('photos').insert(shaped)
  if (error) {
    console.error('[photos/create] insert failed:', error.message)
    return NextResponse.json({ error: 'Could not save uploaded files' }, { status: 500, headers: NO_STORE })
  }

  void maybeNotifyOwner(admin, album, shaped.length)

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}

function shapePhotoRow(albumId: string, row: PhotoRow) {
  const storagePath = String(row.storage_path ?? '').trim()
  const url = String(row.url ?? '').trim()
  const storageBackend = row.storage_backend
  const mediaType = row.media_type
  if (!storagePath.startsWith(`${albumId}/`) || !url) return null
  if (!storageBackend || !STORAGE_BACKENDS.has(storageBackend)) return null
  if (!mediaType || !MEDIA_TYPES.has(mediaType)) return null
  if (mediaType === 'image' && storageBackend !== 'supabase') return null
  if (mediaType === 'video' && storageBackend !== 'r2') return null

  return {
    album_id: albumId,
    storage_path: storagePath,
    storage_backend: storageBackend,
    url,
    caption: mediaTextOrNull(row.caption, MEDIA_CAPTION_MAX),
    author_name: mediaTextOrNull(row.author_name, MEDIA_AUTHOR_MAX),
    media_type: mediaType,
    poster_path: mediaTextOrNull(row.poster_path, 256),
    poster_url: mediaTextOrNull(row.poster_url, 2048),
    duration_seconds: numberOrNull(row.duration_seconds),
  }
}

function numberOrNull(value: unknown) {
  if (value == null) return null
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0 || number > 60 * 60 * 12) return null
  return Math.round(number)
}

const NOTIFICATION_COOLDOWN_MS = 6 * 60 * 60 * 1000 // 6 hours between notification emails
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'

type NotifiableAlbum = {
  id: string
  user_id: string | null
  title: string
  slug: string
  custom_slug: string | null
  last_notification_at: string | null
}

async function maybeNotifyOwner(
  admin: ReturnType<typeof createAdminClient>,
  album: NotifiableAlbum,
  photoCount: number,
) {
  if (!album.user_id) return

  const lastSent = album.last_notification_at ? new Date(album.last_notification_at).getTime() : 0
  if (Date.now() - lastSent < NOTIFICATION_COOLDOWN_MS) return

  try {
    const { data: { user } } = await admin.auth.admin.getUserById(album.user_id)
    const email = user?.email
    if (!email) return

    const publicSlug = album.custom_slug || album.slug
    const albumUrl = `${SITE_URL}/${publicSlug}`

    await admin.from('albums').update({ last_notification_at: new Date().toISOString() }).eq('id', album.id)
    await sendPhotoNotificationEmail(email, album.title, albumUrl, photoCount)
  } catch (err) {
    console.error('[photos/create] notification failed:', err instanceof Error ? err.message : String(err))
  }
}

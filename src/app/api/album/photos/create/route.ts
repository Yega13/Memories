import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { MEDIA_AUTHOR_MAX, MEDIA_CAPTION_MAX, mediaTextOrNull } from '@/lib/media-text'
import { sendPhotoNotificationEmail } from '@/lib/email'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

type PhotoRow = {
  storage_path?: string
  storage_backend?: 'supabase' | 'r2' | 'stream'
  url?: string
  caption?: string | null
  author_name?: string | null
  media_type?: 'image' | 'video'
  poster_path?: string | null
  poster_url?: string | null
  stream_uid?: string | null
  stream_iframe_url?: string | null
  stream_thumbnail_url?: string | null
  thumb_path?: string | null
  thumb_url?: string | null
  duration_seconds?: number | null
}

const STORAGE_BACKENDS = new Set(['supabase', 'r2', 'stream'])
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

  // Per-row tolerant insert: previously one bad row rejected the entire batch of up to 100,
  // leaving R2/Supabase orphans and forcing the client to retry everything. Now we keep only
  // valid rows, insert them, and report how many were rejected. We only fail when zero valid
  // rows remain.
  const shaped = rows.map((row) => shapePhotoRow(albumId, row))
  const valid = shaped.filter((row): row is NonNullable<typeof row> => row !== null)
  const rejectedCount = shaped.length - valid.length

  if (valid.length === 0) {
    return NextResponse.json(
      { error: 'No valid photos in batch', inserted_count: 0, rejected_count: rejectedCount },
      { status: 400, headers: NO_STORE },
    )
  }

  let insertError = (await admin.from('photos').insert(valid)).error
  // If the thumb_path / thumb_url columns don't exist yet (migration not applied), strip them
  // and retry. The original upload + grid still work — they just won't have thumbnails until
  // the column lands.
  if (insertError && /thumb_path|thumb_url|column .* does not exist|schema cache/i.test(insertError.message ?? '')) {
    const stripped = valid.map((row) => {
      const { thumb_path: _tp, thumb_url: _tu, ...rest } = row
      void _tp; void _tu
      return rest
    })
    insertError = (await admin.from('photos').insert(stripped)).error
  }
  if (insertError) {
    console.error('[photos/create] insert failed:', insertError.message)
    return NextResponse.json({ error: 'Could not save uploaded files' }, { status: 500, headers: NO_STORE })
  }

  void maybeNotifyOwner(admin, album, valid.length)

  return NextResponse.json(
    { ok: true, inserted_count: valid.length, rejected_count: rejectedCount },
    { headers: NO_STORE },
  )
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
  if (mediaType === 'video' && storageBackend !== 'r2' && storageBackend !== 'stream') return null

  // Validate thumbnail fields if present. Both must be album-scoped + a https url, or both
  // must be null (no half-state). On failure we drop them silently (insert without thumb)
  // rather than reject the whole row — the original still uploaded.
  const rawThumbPath = row.thumb_path != null ? String(row.thumb_path).trim() : ''
  const rawThumbUrl = row.thumb_url != null ? String(row.thumb_url).trim() : ''
  let thumbPath: string | null = null
  let thumbUrl: string | null = null
  if (rawThumbPath && rawThumbUrl) {
    if (rawThumbPath.startsWith(`${albumId}/`) && rawThumbUrl.startsWith('https://')) {
      thumbPath = mediaTextOrNull(rawThumbPath, 256)
      thumbUrl = mediaTextOrNull(rawThumbUrl, 2048)
    }
  }

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
    stream_uid: mediaTextOrNull(row.stream_uid, 128),
    stream_iframe_url: mediaTextOrNull(row.stream_iframe_url, 2048),
    stream_thumbnail_url: mediaTextOrNull(row.stream_thumbnail_url, 2048),
    thumb_path: thumbPath,
    thumb_url: thumbUrl,
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

import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { createAdminClient } from '@/lib/supabase/admin'
import type { R2Env } from '@/lib/r2'
import { storagePathFromPublicPhotoUrl } from '@/lib/storage-path'
import { deleteCollection } from '@/lib/rekognition'
import { deleteStreamVideo } from '@/lib/cloudflare-stream'

type AdminClient = ReturnType<typeof createAdminClient>

type AlbumDeleteTarget = {
  id: string
  background_theme: string | null
}

type PhotoToDelete = {
  storage_path: string
  storage_backend: 'supabase' | 'r2' | 'stream'
  poster_path: string | null
  stream_uid: string | null
  mirror_path: string | null
}

export async function deleteAlbumAssetsAndRows(
  admin: AdminClient,
  album: AlbumDeleteTarget,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let photos: PhotoToDelete[] | null = null
  let photosError: { message: string } | null = null
  {
    const full = await admin
      .from('photos')
      .select('storage_path, storage_backend, poster_path, stream_uid, mirror_path')
      .eq('album_id', album.id)
      .returns<PhotoToDelete[]>()

    if (full.error && /mirror_path|column .* does not exist/i.test(full.error.message ?? '')) {
      const fallback = await admin
        .from('photos')
        .select('storage_path, storage_backend, poster_path, stream_uid')
        .eq('album_id', album.id)
        .returns<Omit<PhotoToDelete, 'mirror_path'>[]>()
      photos = fallback.data?.map((photo) => ({ ...photo, mirror_path: null })) ?? null
      photosError = fallback.error
    } else {
      photos = full.data
      photosError = full.error
    }
  }

  if (photosError) {
    console.error('[album/delete] photo lookup failed:', photosError.message)
    return { ok: false, error: 'Could not prepare album deletion' }
  }

  const supabasePaths = new Set<string>()
  const r2Paths = new Set<string>()
  const streamUids = new Set<string>()
  for (const photo of photos ?? []) {
    if (photo.storage_backend === 'stream') {
      if (photo.stream_uid) streamUids.add(photo.stream_uid)
      if (photo.poster_path) r2Paths.add(photo.poster_path)
      if (photo.mirror_path) r2Paths.add(photo.mirror_path)
    } else {
      const target = photo.storage_backend === 'r2' ? r2Paths : supabasePaths
      target.add(photo.storage_path)
      if (photo.poster_path) target.add(photo.poster_path)
    }
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

  for (const uid of streamUids) {
    try {
      await deleteStreamVideo(uid)
    } catch (e) {
      console.error('[album/delete] Stream remove failed:', e instanceof Error ? e.message : String(e))
    }
  }

  await admin.from('collection_albums').delete().eq('album_id', album.id)
  await admin.from('photos').delete().eq('album_id', album.id)

  // Drop the Rekognition collection (and all its faces) for this album. Best-effort — never
  // block the album delete on AWS being reachable.
  try {
    await deleteCollection(album.id)
  } catch (e) {
    console.error('[album/delete] Rekognition deleteCollection failed:', e instanceof Error ? e.message : String(e))
  }

  const { error: deleteError } = await admin.from('albums').delete().eq('id', album.id)
  if (deleteError) {
    console.error('[album/delete] DB delete failed:', deleteError.message)
    return { ok: false, error: 'Could not delete album' }
  }

  return { ok: true }
}

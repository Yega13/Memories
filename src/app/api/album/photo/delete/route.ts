import { NextResponse } from 'next/server'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { R2Env } from '@/lib/r2'
import { createAdminClient } from '@/lib/supabase/admin'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyAlbumOwnerAccess } from '@/lib/album-owner-access'
import { deleteFaces } from '@/lib/rekognition'
import { deleteStreamVideo } from '@/lib/cloudflare-stream'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: { slug?: string; owner_token?: string; photo_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  const token = String(body.owner_token ?? '').trim()
  const photoId = String(body.photo_id ?? '').trim()

  if (!slug || !token || !photoId) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400, headers: NO_STORE })
  }

  const access = await verifyAlbumOwnerAccess(slug, token)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status, headers: NO_STORE })
  }

  const admin = createAdminClient()
  const { data: photo, error: photoError } = await admin
    .from('photos')
    .select('id, album_id, storage_path, storage_backend, poster_path, stream_uid, face_ids')
    .eq('id', photoId)
    .maybeSingle<{
      id: string
      album_id: string
      storage_path: string
      storage_backend: 'supabase' | 'r2' | 'stream'
      poster_path: string | null
      stream_uid: string | null
      face_ids: string[] | null
    }>()

  if (photoError || !photo) {
    return NextResponse.json({ error: 'Photo not found' }, { status: 404, headers: NO_STORE })
  }
  if (photo.album_id !== access.album.id) {
    return NextResponse.json({ error: 'Photo does not belong to this album' }, { status: 403, headers: NO_STORE })
  }

  const paths = [photo.storage_path]
  if (photo.poster_path) paths.push(photo.poster_path)

  if (photo.storage_backend === 'stream') {
    if (photo.stream_uid) {
      try {
        await deleteStreamVideo(photo.stream_uid)
      } catch (e) {
        console.error('[photo/delete] Stream remove failed:', e instanceof Error ? e.message : String(e))
      }
    }
  } else if (photo.storage_backend === 'r2') {
    const ctx = getCloudflareContext()
    const bucket = (ctx?.env as R2Env | undefined)?.R2_VIDEOS
    if (bucket) {
      try {
        await bucket.delete(paths)
      } catch (e) {
        console.error('[photo/delete] R2 remove failed:', e)
      }
    } else {
      console.error('[photo/delete] R2 binding unavailable; orphaning', paths)
    }
  } else {
    const { error: storageError } = await admin.storage.from('Photos').remove(paths)
    if (storageError) {
      console.error('[photo/delete] storage remove failed:', storageError.message)
    }
  }

  const { error: dbError } = await admin.from('photos').delete().eq('id', photoId)
  if (dbError) {
    console.error('[photo/delete] DB delete failed:', dbError.message)
    return NextResponse.json({ error: 'Could not delete photo' }, { status: 500, headers: NO_STORE })
  }

  // If this photo was the album's cover, clear that reference so the gallery doesn't break.
  await admin.from('albums').update({ cover_photo_id: null }).eq('id', photo.album_id).eq('cover_photo_id', photoId)

  // Remove any indexed faces from Rekognition. Best-effort: don't fail the delete if AWS is
  // unreachable — the photo is already gone. Without this, deleted photos' faces would stay in
  // the collection forever, costing money and potentially matching future selfie searches.
  if (photo.face_ids && photo.face_ids.length > 0) {
    try {
      await deleteFaces(photo.album_id, photo.face_ids)
    } catch (e) {
      console.error('[photo/delete] Rekognition deleteFaces failed:', e instanceof Error ? e.message : String(e))
    }
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureCollection, indexPhotoFaces } from '@/lib/rekognition'

export const runtime = 'nodejs'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' }

// Rekognition rejects images > 5 MB via the direct-bytes API, and even smaller multi-MB
// originals burn Cloudflare Worker CPU during fetch + base64 + signing. Convert the standard
// Supabase public URL into a /render/image/ transform URL so we get a downscaled JPEG instead.
// Width 1280 is well within Rekognition's working range and produces ~200-400 KB files.
// 600 px / q75 produces ~50-80 KB files — small enough that base64 encode + Sig V4 signing
// fits within Cloudflare Workers Free plan's 10 ms CPU budget. Rekognition detects faces down
// to 36×36 px, so even in a group photo of 10 people at 600 px each face is ~60 px.
// (Upgrade account to Workers Paid + set [limits] cpu_ms = 30000 in wrangler.toml to use
// larger images with better detection accuracy on crowd shots.)
const FACE_INDEX_MAX_WIDTH = 600
const FACE_INDEX_QUALITY = 75
function faceIndexImageUrl(photoUrl: string): string {
  const marker = '/storage/v1/object/public/'
  const idx = photoUrl.indexOf(marker)
  if (idx === -1) return photoUrl
  const rewritten =
    photoUrl.slice(0, idx) +
    '/storage/v1/render/image/public/' +
    photoUrl.slice(idx + marker.length)
  return `${rewritten}?width=${FACE_INDEX_MAX_WIDTH}&quality=${FACE_INDEX_QUALITY}`
}

async function resolveAlbum(slug: string) {
  const admin = createAdminClient()
  const { data: album } = await admin
    .from('albums')
    .select('id')
    .or(`slug.eq.${slug},custom_slug.eq.${slug}`)
    .maybeSingle<{ id: string }>()
  return { admin, album }
}

// GET: returns all unindexed photo IDs so the client can distribute work across concurrent workers
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get('slug')?.trim() ?? ''
  if (!slug) return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })

  const { admin, album } = await resolveAlbum(slug)
  if (!album) return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })

  await ensureCollection(album.id)

  const { data: unindexed } = await admin
    .from('photos')
    .select('id')
    .eq('album_id', album.id)
    .is('face_ids', null)
    .neq('media_type', 'video')
    .order('created_at', { ascending: true })

  const { count: total } = await admin
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('album_id', album.id)
    .neq('media_type', 'video')

  return NextResponse.json(
    { ids: unindexed?.map((p) => p.id) ?? [], total: total ?? 0 },
    { headers: NO_STORE },
  )
}

export async function POST(req: Request) {
  try {
    return await handlePost(req)
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    console.error('[face-index] unhandled:', msg)
    return NextResponse.json({ error: msg }, { status: 500, headers: NO_STORE })
  }
}

async function handlePost(req: Request) {
  let body: { slug?: string; photoId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  if (!slug) return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })

  const { admin, album } = await resolveAlbum(slug)
  if (!album) return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })

  const photoId = body.photoId ? String(body.photoId).trim() : null

  if (photoId) {
    // Targeted mode: process exactly one photo (called by concurrent FaceFinder workers)
    const { data: photo } = await admin
      .from('photos')
      .select('id, url, face_ids')
      .eq('id', photoId)
      .eq('album_id', album.id)
      .maybeSingle<{ id: string; url: string; face_ids: string[] | null }>()

    if (!photo) return NextResponse.json({ error: 'Photo not found' }, { status: 404, headers: NO_STORE })
    // Already indexed by a concurrent worker — skip silently
    if (photo.face_ids !== null) return NextResponse.json({ indexed: 0 }, { headers: NO_STORE })

    try {
      const faceIds = await indexPhotoFaces(album.id, photo.id, faceIndexImageUrl(photo.url))
      await admin.from('photos').update({ face_ids: faceIds }).eq('id', photo.id)
      return NextResponse.json({ indexed: 1 }, { headers: NO_STORE })
    } catch (err) {
      // Log the actual reason so `wrangler tail` can show why a photo was marked unindexable.
      // Previously this was a bare `catch {}` which masked AWS credentials/region/throttling
      // issues entirely.
      const name = (err as { name?: string }).name ?? 'Unknown'
      const message = err instanceof Error ? err.message : String(err)
      console.error('[face-index] indexPhotoFaces failed:', photo.id, name, message)
      await admin.from('photos').update({ face_ids: [] }).eq('id', photo.id)
      return NextResponse.json({ indexed: 0 }, { headers: NO_STORE })
    }
  }

  // Fallback scan mode (single photo at a time to stay within the 30 s Worker limit)
  const { data: photos } = await admin
    .from('photos')
    .select('id, url')
    .eq('album_id', album.id)
    .is('face_ids', null)
    .neq('media_type', 'video')
    .limit(1)

  const toIndex = photos ?? []

  const { count: remaining } = await admin
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('album_id', album.id)
    .is('face_ids', null)
    .neq('media_type', 'video')

  let indexed = 0
  for (const photo of toIndex) {
    try {
      const faceIds = await indexPhotoFaces(album.id, photo.id, faceIndexImageUrl(photo.url))
      await admin.from('photos').update({ face_ids: faceIds }).eq('id', photo.id)
      indexed++
    } catch (err) {
      const name = (err as { name?: string }).name ?? 'Unknown'
      const message = err instanceof Error ? err.message : String(err)
      console.error('[face-index/fallback] indexPhotoFaces failed:', photo.id, name, message)
      await admin.from('photos').update({ face_ids: [] }).eq('id', photo.id)
    }
  }

  return NextResponse.json(
    { indexed, remaining: Math.max(0, (remaining ?? 0) - toIndex.length) },
    { headers: NO_STORE },
  )
}

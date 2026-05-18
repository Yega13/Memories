import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createRekognitionClient, ensureCollection, indexPhotoFaces } from '@/lib/rekognition'

export const runtime = 'nodejs'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'no-store' }
const BATCH = 15

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
  let body: { slug?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  if (!slug) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()

  // Resolve album
  const { data: album } = await admin
    .from('albums')
    .select('id')
    .or(`slug.eq.${slug},custom_slug.eq.${slug}`)
    .maybeSingle<{ id: string }>()

  if (!album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }

  const rek = createRekognitionClient()
  await ensureCollection(rek, album.id)

  // Find unindexed image photos (face_ids IS NULL means not yet processed)
  const { data: photos } = await admin
    .from('photos')
    .select('id, url, media_type')
    .eq('album_id', album.id)
    .is('face_ids', null)
    .neq('media_type', 'video')
    .limit(BATCH)

  const toIndex = photos ?? []

  // Count remaining after this batch
  const { count: remaining } = await admin
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('album_id', album.id)
    .is('face_ids', null)
    .neq('media_type', 'video')

  let indexed = 0
  const errors: string[] = []

  await Promise.all(
    toIndex.map(async (photo) => {
      try {
        const faceIds = await indexPhotoFaces(rek, album.id, photo.id, photo.url)
        await admin
          .from('photos')
          .update({ face_ids: faceIds })
          .eq('id', photo.id)
        indexed++
      } catch {
        errors.push(photo.id)
        // Mark as processed with empty array so we don't retry endlessly on bad images
        await admin
          .from('photos')
          .update({ face_ids: [] })
          .eq('id', photo.id)
      }
    }),
  )

  const stillRemaining = Math.max(0, (remaining ?? 0) - toIndex.length)

  return NextResponse.json(
    { indexed, errors: errors.length, remaining: stillRemaining },
    { headers: NO_STORE },
  )
}

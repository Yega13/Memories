import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createRekognitionClient, ensureCollection, searchFacesByImage } from '@/lib/rekognition'

export const runtime = 'nodejs'
export const maxDuration = 30

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_SELFIE_BYTES = 5 * 1024 * 1024 // 5MB — Rekognition limit

export async function POST(req: Request) {
  let slug: string
  let selfieBytes: Uint8Array

  try {
    const form = await req.formData()
    slug = String(form.get('slug') ?? '').trim()
    const file = form.get('selfie')
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Missing selfie file' }, { status: 400, headers: NO_STORE })
    }
    if (file.size > MAX_SELFIE_BYTES) {
      return NextResponse.json({ error: 'Selfie too large (max 5MB)' }, { status: 400, headers: NO_STORE })
    }
    selfieBytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400, headers: NO_STORE })
  }

  if (!slug) {
    return NextResponse.json({ error: 'Missing slug' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()

  const { data: album } = await admin
    .from('albums')
    .select('id')
    .or(`slug.eq.${slug},custom_slug.eq.${slug}`)
    .maybeSingle<{ id: string }>()

  if (!album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }

  // Verify there are indexed photos — otherwise collection may not exist yet
  const { count: indexedCount } = await admin
    .from('photos')
    .select('id', { count: 'exact', head: true })
    .eq('album_id', album.id)
    .not('face_ids', 'is', null)

  if (!indexedCount || indexedCount === 0) {
    return NextResponse.json(
      { error: 'No photos have been indexed yet. Please wait for indexing to complete.' },
      { status: 422, headers: NO_STORE },
    )
  }

  const rek = createRekognitionClient()
  await ensureCollection(rek, album.id)

  let matches: { photoId: string; similarity: number }[]
  try {
    matches = await searchFacesByImage(rek, album.id, selfieBytes)
  } catch (err: unknown) {
    const name = (err as { name?: string }).name
    if (name === 'InvalidParameterException') {
      return NextResponse.json(
        { error: 'No face detected in selfie. Try a clearer photo facing the camera.' },
        { status: 422, headers: NO_STORE },
      )
    }
    if (name === 'ResourceNotFoundException') {
      return NextResponse.json(
        { error: 'Album not indexed yet. Please try again in a moment.' },
        { status: 422, headers: NO_STORE },
      )
    }
    throw err
  }

  return NextResponse.json({ matches }, { headers: NO_STORE })
}

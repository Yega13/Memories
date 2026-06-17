import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { searchFacesByImage } from '@/lib/rekognition'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { getUserTierById } from '@/lib/subscriptions'
import { checkRateLimit, clientIpKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const maxDuration = 30

const NO_STORE = { 'Cache-Control': 'no-store' }
const MAX_SELFIE_BYTES = 5 * 1024 * 1024

const SLUG_RE = /^[a-zA-Z0-9._-]{1,200}$/
function isValidSlug(s: string): boolean { return SLUG_RE.test(s) }

// Rekognition calls cost money, so rate limits must be shared across Worker instances.
const SEARCH_WINDOW_SECONDS = 60
const SEARCH_IP_MAX = 10
const SEARCH_ALBUM_MAX = 60

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden
  try {
    return await handlePost(req)
  } catch (err) {
    // Without this outer catch, any unhandled error (e.g. an AWS Rekognition error not in the
    // explicit list below) crashes the Worker and Cloudflare returns its 503 HTML interstitial
    // — which the client can't parse, so the user sees a useless "Server error (503): <!DOCTYPE
    // html>" message. Logging the real reason here lets us diagnose via `wrangler tail`.
    const name = (err as { name?: string }).name ?? 'Unknown'
    const message = err instanceof Error ? err.message : String(err)
    console.error('[face-search] unhandled:', name, message)
    return NextResponse.json(
      { error: `Face search failed (${name}). Please try again or contact support.` },
      { status: 500, headers: NO_STORE },
    )
  }
}

async function handlePost(req: Request) {
  const ipLimit = await checkRateLimit(clientIpKey(req, 'face_search'), SEARCH_WINDOW_SECONDS, SEARCH_IP_MAX, { failOpen: true })
  if (!ipLimit.ok) {
    return NextResponse.json(
      { error: 'Too many searches. Please wait a minute and try again.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(ipLimit.retryAfterSeconds) } },
    )
  }

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

  if (!slug || !isValidSlug(slug)) {
    return NextResponse.json({ error: 'Invalid slug' }, { status: 400, headers: NO_STORE })
  }

  const admin = createAdminClient()

  const { data: album } = await admin
    .from('albums')
    .select('id, user_id')
    .or(`slug.eq.${slug},custom_slug.eq.${slug}`)
    .maybeSingle<{ id: string; user_id: string | null }>()

  if (!album) {
    return NextResponse.json({ error: 'Album not found' }, { status: 404, headers: NO_STORE })
  }
  if ((await getUserTierById(album.user_id)) !== 'studio') {
    return NextResponse.json({ error: 'Face Finder is not enabled for this album' }, { status: 403, headers: NO_STORE })
  }

  const albumLimit = await checkRateLimit(`face_search_album:${album.id}`, SEARCH_WINDOW_SECONDS, SEARCH_ALBUM_MAX, { failOpen: true })
  if (!albumLimit.ok) {
    return NextResponse.json(
      { error: 'Too many searches. Please wait a minute and try again.' },
      { status: 429, headers: { ...NO_STORE, 'Retry-After': String(albumLimit.retryAfterSeconds) } },
    )
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

  // ensureCollection is intentionally omitted here: indexedCount > 0 guarantees the collection
  // already exists (faces can only be indexed into an existing collection). Calling it anyway
  // would add an unnecessary Rekognition round-trip (~100-300 ms) to every search.

  let matches: { photoId: string; similarity: number }[]
  try {
    matches = await searchFacesByImage(album.id, selfieBytes)
  } catch (err: unknown) {
    const name = (err as { name?: string }).name
    const message = err instanceof Error ? err.message : String(err)
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
    // Surface other Rekognition errors with their AWS name so we can diagnose. Previously a
    // re-throw here bubbled out of the handler and Cloudflare returned a 503 HTML interstitial
    // with no clue what went wrong (AccessDenied, Throttling, etc.).
    console.error('[face-search] Rekognition error:', name, message)
    return NextResponse.json(
      { error: `Face search failed: ${name ?? 'Unknown'} — ${message.slice(0, 200)}` },
      { status: 502, headers: NO_STORE },
    )
  }

  return NextResponse.json({ matches }, { headers: NO_STORE })
}

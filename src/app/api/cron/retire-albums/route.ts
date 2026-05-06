import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { deleteAlbumAssetsAndRows } from '@/lib/album-delete'
import { getUserTierById } from '@/lib/subscriptions'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }
const RETIRE_AFTER_DAYS = 365
const BATCH_SIZE = 25

type RetirementCandidate = {
  id: string
  user_id: string | null
  background_theme: string | null
  last_activity_at: string
}

export async function POST(req: Request) {
  // Fail-closed: a missing secret in production means anyone could trigger
  // mass deletion of inactive free albums. Refuse to run unless the secret
  // is set AND the caller presents it.
  const secret = process.env.ALBUM_RETIREMENT_SECRET
  if (!secret) {
    console.error('[retire-albums] ALBUM_RETIREMENT_SECRET not set; refusing to run')
    return NextResponse.json({ error: 'Not configured' }, { status: 503, headers: NO_STORE })
  }
  const auth = req.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  }

  const cutoff = new Date(Date.now() - RETIRE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const admin = createAdminClient()
  const { data: candidates, error } = await admin
    .from('albums')
    .select('id, user_id, background_theme, last_activity_at')
    .is('retired_at', null)
    .lt('last_activity_at', cutoff)
    .order('last_activity_at', { ascending: true })
    .limit(BATCH_SIZE)
    .returns<RetirementCandidate[]>()

  if (error) {
    console.error('[retire-albums] candidate lookup failed:', error.message)
    return NextResponse.json({ error: 'Could not scan albums' }, { status: 500, headers: NO_STORE })
  }

  let retired = 0
  let skippedPaid = 0
  let failed = 0

  for (const album of candidates ?? []) {
    const tier = await getUserTierById(album.user_id)
    if (tier !== 'free') {
      skippedPaid += 1
      await admin.from('albums').update({ last_activity_at: new Date().toISOString() }).eq('id', album.id)
      continue
    }

    await admin.from('albums').update({ retired_at: new Date().toISOString() }).eq('id', album.id)
    const result = await deleteAlbumAssetsAndRows(admin, album)
    if (result.ok) retired += 1
    else failed += 1
  }

  return NextResponse.json(
    { ok: true, scanned: candidates?.length ?? 0, retired, skippedPaid, failed, cutoff },
    { headers: NO_STORE },
  )
}

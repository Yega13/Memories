import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { forbidCrossSiteRequest } from '@/lib/request-security'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

function slug() {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}

function ownerToken() {
  return randomUUID().replace(/-/g, '')
}

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: { title?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const title = String(body.title ?? '').trim().slice(0, 120)
  if (!title) {
    return NextResponse.json({ error: 'Please give your album a name' }, { status: 400, headers: NO_STORE })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const admin = createAdminClient()

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const nextSlug = slug()
    const nextOwnerToken = ownerToken()
    const row = user
      ? { slug: nextSlug, owner_token: nextOwnerToken, title, user_id: user.id }
      : { slug: nextSlug, owner_token: nextOwnerToken, title }

    const { error } = await admin.from('albums').insert(row)
    if (!error) {
      return NextResponse.json(
        { slug: nextSlug, owner_token: nextOwnerToken },
        { headers: NO_STORE },
      )
    }
    if (error.code !== '23505') {
      console.error('[album/create] insert failed:', error.message)
      return NextResponse.json({ error: 'Could not create album' }, { status: 500, headers: NO_STORE })
    }
  }

  return NextResponse.json({ error: 'Could not create a unique album link' }, { status: 500, headers: NO_STORE })
}

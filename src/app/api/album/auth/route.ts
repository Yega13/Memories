import { NextResponse } from 'next/server'
import { forbidCrossSiteRequest } from '@/lib/request-security'
import { verifyOwnerViaCookie } from '@/lib/album-owner-access'

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(req: Request) {
  const forbidden = forbidCrossSiteRequest(req)
  if (forbidden) return forbidden

  let body: { slug?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers: NO_STORE })
  }

  const slug = String(body.slug ?? '').trim()
  if (!slug) {
    return NextResponse.json({ isOwner: false }, { headers: NO_STORE })
  }

  const access = await verifyOwnerViaCookie(slug)
  if (!access.ok) {
    if (access.reason === 'access_denied') {
      return NextResponse.json({ isOwner: false, accessDenied: true, error: access.error }, { headers: NO_STORE })
    }
    return NextResponse.json({ isOwner: false }, { headers: NO_STORE })
  }

  return NextResponse.json({ isOwner: true }, { headers: NO_STORE })
}

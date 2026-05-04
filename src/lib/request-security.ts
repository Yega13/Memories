import { NextResponse } from 'next/server'

const ALLOWED_ORIGIN_HOSTS = new Set(['hushare.space', 'www.hushare.space'])

export function forbidCrossSiteRequest(req: Request) {
  const origin = req.headers.get('origin')
  if (!origin) return null

  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return forbidden()
  }

  const host = req.headers.get('host')
  if (host && url.host === host) return null
  if (ALLOWED_ORIGIN_HOSTS.has(url.host)) return null
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return null

  return forbidden()
}

function forbidden() {
  return NextResponse.json(
    { error: 'Forbidden' },
    { status: 403, headers: { 'Cache-Control': 'no-store' } },
  )
}

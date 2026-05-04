const baseUrl = (process.env.SMOKE_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const cronSecret = process.env.ALBUM_RETIREMENT_SECRET || process.env.SMOKE_CRON_SECRET

const checks = [
  { name: 'home page', path: '/', method: 'GET', expect: 'html' },
  { name: 'pricing page', path: '/pricing', method: 'GET', expect: 'html' },
  { name: 'support page', path: '/support', method: 'GET', expect: 'html' },
]

if (cronSecret) {
  checks.push({
    name: 'album retirement cron',
    path: '/api/cron/retire-albums',
    method: 'POST',
    expect: 'json',
    headers: { Authorization: `Bearer ${cronSecret}` },
  })
}

let failed = 0

console.log(`Smoke target: ${baseUrl}`)

for (const check of checks) {
  let res
  try {
    res = await fetch(`${baseUrl}${check.path}`, {
      method: check.method,
      headers: check.headers,
      cache: 'no-store',
    })
  } catch {
    console.error(`FAIL ${check.name}: could not connect to ${baseUrl}`)
    console.error('Start the app first with `npm run dev`, or set SMOKE_BASE_URL to the URL printed by Next.js.')
    process.exit(1)
  }
  const contentType = res.headers.get('content-type') || ''
  const okType = check.expect === 'json'
    ? contentType.includes('application/json')
    : contentType.includes('text/html')

  if (!res.ok || !okType) {
    failed += 1
    console.error(`FAIL ${check.name}: ${res.status} ${contentType}`)
    continue
  }

  if (check.expect === 'json') {
    const body = await res.json().catch(() => null)
    if (!body || body.ok !== true) {
      failed += 1
      console.error(`FAIL ${check.name}: invalid JSON response`)
      continue
    }
  }

  console.log(`PASS ${check.name}`)
}

if (!cronSecret) {
  console.log('SKIP album retirement cron: set SMOKE_CRON_SECRET or ALBUM_RETIREMENT_SECRET')
}

process.exit(failed ? 1 : 0)

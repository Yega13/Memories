const baseUrl = (process.env.HEALTH_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '')

const res = await fetch(`${baseUrl}/api/health`, {
  headers: { Accept: 'application/json' },
})

const body = await res.json().catch(() => null)
console.log(JSON.stringify({ status: res.status, body }, null, 2))

if (!res.ok) {
  process.exitCode = 1
}

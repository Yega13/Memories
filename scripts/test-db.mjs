import { readFileSync } from 'fs'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const eq = line.indexOf('=')
  if (eq < 1) continue
  env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
}

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY

console.log('URL:', url)
console.log('Key ref (from JWT):', JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString()).ref)

// Test 1: rate_limit_events table
const r1 = await fetch(`${url}/rest/v1/rate_limit_events?select=id&limit=1`, {
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
  }
})
console.log('\nrate_limit_events query:', r1.status, await r1.text())

// Test 2: albums table
const r2 = await fetch(`${url}/rest/v1/albums?select=id&limit=1`, {
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
  }
})
console.log('albums query:', r2.status, await r2.text())

/**
 * Deletes ALL objects from the Supabase Photos bucket via S3-compatible API.
 * Uses SigV4 signing — no npm packages needed beyond Node.js built-ins.
 *
 * Usage:
 *   node scripts/clear-supabase-storage.mjs --dry-run
 *   node scripts/clear-supabase-storage.mjs
 *
 * Add to .env.local before running:
 *   SUPABASE_S3_ACCESS_KEY_ID=...
 *   SUPABASE_S3_SECRET_ACCESS_KEY=...
 */

import { readFileSync } from 'node:fs'
import { createHmac, createHash } from 'node:crypto'

// ── Load .env.local ────────────────────────────────────────────────────────────
function loadEnv() {
  try {
    for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
      const eq = line.indexOf('=')
      if (eq < 1) continue
      const key = line.slice(0, eq).trim()
      const val = line.slice(eq + 1).trim()
      if (key && val && !process.env[key]) process.env[key] = val
    }
  } catch { /* optional */ }
}
loadEnv()

const ACCESS_KEY    = process.env.SUPABASE_S3_ACCESS_KEY_ID     ?? ''
const SECRET_KEY    = process.env.SUPABASE_S3_SECRET_ACCESS_KEY ?? ''
const ENDPOINT      = 'zleajzevvhugkwlqlolt.storage.supabase.co'
const BUCKET        = 'Photos'
const REGION        = 'ap-southeast-1'

if (!ACCESS_KEY || !SECRET_KEY) {
  console.error('Missing SUPABASE_S3_ACCESS_KEY_ID or SUPABASE_S3_SECRET_ACCESS_KEY in .env.local')
  process.exit(1)
}

const dryRun = process.argv.includes('--dry-run')

// ── SigV4 helpers ──────────────────────────────────────────────────────────────
function sha256hex(data) {
  return createHash('sha256').update(data).digest('hex')
}
function hmac(key, data) {
  return createHmac('sha256', key).update(data).digest()
}
function signingKey(dateStr) {
  let k = hmac(`AWS4${SECRET_KEY}`, dateStr)
  k = hmac(k, REGION)
  k = hmac(k, 's3')
  return hmac(k, 'aws4_request')
}

function makeHeaders(method, path, query, body, extraHeaders = {}) {
  const now     = new Date()
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const dateStr = amzDate.slice(0, 8)
  const host    = ENDPOINT

  const payloadHash = sha256hex(body ?? '')
  const allHeaders  = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  }
  if (body) allHeaders['content-type'] = 'application/xml'

  const sortedKeys    = Object.keys(allHeaders).sort()
  const canonHeaders  = sortedKeys.map(k => `${k}:${allHeaders[k]}`).join('\n') + '\n'
  const signedHeaders = sortedKeys.join(';')

  const canonRequest = [method, `/storage/v1/s3/${BUCKET}${path}`, query, canonHeaders, signedHeaders, payloadHash].join('\n')
  const credScope    = `${dateStr}/${REGION}/s3/aws4_request`
  const strToSign    = `AWS4-HMAC-SHA256\n${amzDate}\n${credScope}\n${sha256hex(canonRequest)}`
  const signature    = createHmac('sha256', signingKey(dateStr)).update(strToSign).digest('hex')

  return {
    ...allHeaders,
    'Authorization': `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/${credScope},SignedHeaders=${signedHeaders},Signature=${signature}`,
  }
}

// ── List all objects (paginated) ───────────────────────────────────────────────
async function listAll() {
  const keys = []
  let token  = null

  for (;;) {
    const query = 'list-type=2&max-keys=1000' + (token ? `&continuation-token=${encodeURIComponent(token)}` : '')
    const headers = makeHeaders('GET', '', query)
    const res = await fetch(`https://${ENDPOINT}/storage/v1/s3/${BUCKET}?${query}`, { headers })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`ListObjects ${res.status}: ${txt.slice(0, 300)}`)
    }
    const xml = await res.text()

    const keyMatches = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1])
    keys.push(...keyMatches)

    const isTruncated = xml.includes('<IsTruncated>true</IsTruncated>')
    if (!isTruncated) break
    const tokenMatch = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)
    if (!tokenMatch) break
    token = tokenMatch[1]
  }

  return keys
}

// ── Delete a batch of keys (max 1000) ─────────────────────────────────────────
async function deleteBatch(keys) {
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/">',
    ...keys.map(k => `<Object><Key>${k.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</Key></Object>`),
    '</Delete>',
  ].join('')

  const bodyHash = sha256hex(body)
  const headers  = makeHeaders('POST', '', 'delete', body)
  const res = await fetch(`https://${ENDPOINT}/storage/v1/s3/${BUCKET}?delete`, {
    method: 'POST',
    headers,
    body,
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`DeleteObjects ${res.status}: ${txt.slice(0, 300)}`)
  }
  return await res.text()
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Listing all objects in bucket "${BUCKET}"...`)
  const keys = await listAll()
  console.log(`Found ${keys.length} objects (${dryRun ? 'DRY RUN — will not delete' : 'will delete all'})`)

  if (dryRun || keys.length === 0) {
    if (keys.length > 0) {
      console.log('Sample keys:')
      keys.slice(0, 5).forEach(k => console.log('  ', k))
    }
    return
  }

  let deleted = 0
  const batchSize = 1000
  for (let i = 0; i < keys.length; i += batchSize) {
    const batch = keys.slice(i, i + batchSize)
    process.stdout.write(`Deleting ${i + 1}–${Math.min(i + batchSize, keys.length)} of ${keys.length}...`)
    await deleteBatch(batch)
    deleted += batch.length
    console.log(' done')
  }

  console.log(`\nDeleted ${deleted} objects from "${BUCKET}".`)
  console.log('Storage should now be 0 MB. Supabase restriction will lift within a few minutes.')
}

main().catch(err => { console.error(err); process.exit(1) })

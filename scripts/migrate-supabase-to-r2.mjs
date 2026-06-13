/**
 * Migrates photos from a CSV export to R2.
 *
 * Works entirely without the Supabase REST API (PostgREST) — uses only:
 *   1. Public Supabase storage HTTP URLs to download files
 *   2. R2 S3-compatible API (SigV4) to upload files
 *   3. Outputs a SQL file with UPDATE statements to paste into the SQL Editor
 *
 * Usage:
 *   node scripts/migrate-supabase-to-r2.mjs photos.csv --dry-run
 *   node scripts/migrate-supabase-to-r2.mjs photos.csv
 *
 * CSV must have columns: id, album_id, storage_path, media_type, thumb_url
 * (exported from Supabase SQL Editor)
 *
 * Required env vars in .env.local:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   R2_ACCOUNT_ID
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 */

import { readFileSync, writeFileSync, createWriteStream } from 'node:fs'
import { createHmac, createHash } from 'node:crypto'
import { basename, extname } from 'node:path'

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
  } catch { /* .env.local optional */ }
}
loadEnv()

const SUPABASE_URL             = process.env.NEXT_PUBLIC_SUPABASE_URL        ?? ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY       ?? ''
const R2_ACCOUNT_ID            = process.env.R2_ACCOUNT_ID                   ?? ''
const R2_ACCESS_KEY_ID         = process.env.R2_ACCESS_KEY_ID                ?? ''
const R2_SECRET_ACCESS_KEY     = process.env.R2_SECRET_ACCESS_KEY            ?? ''
const R2_BUCKET                = 'hushare-videos'
const R2_PUBLIC_HOST           = 'videos.hushare.space'

const missing = [
  ['NEXT_PUBLIC_SUPABASE_URL',   SUPABASE_URL],
  ['SUPABASE_SERVICE_ROLE_KEY',  SUPABASE_SERVICE_ROLE_KEY],
  ['R2_ACCOUNT_ID',              R2_ACCOUNT_ID],
  ['R2_ACCESS_KEY_ID',           R2_ACCESS_KEY_ID],
  ['R2_SECRET_ACCESS_KEY',       R2_SECRET_ACCESS_KEY],
].filter(([, v]) => !v).map(([k]) => k)

if (missing.length) {
  console.error('Missing env vars — add these to .env.local:\n  ' + missing.join('\n  '))
  process.exit(1)
}

// ── CSV parser ─────────────────────────────────────────────────────────────────
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const header = lines[0].split(',')
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    // Simple CSV parse — handles unquoted fields (Supabase SQL export doesn't quote unless needed)
    const cols = line.split(',')
    const row = {}
    for (let j = 0; j < header.length; j++) row[header[j].trim()] = (cols[j] ?? '').trim()
    rows.push(row)
  }
  return rows
}

// ── AWS SigV4 for R2 ───────────────────────────────────────────────────────────
function sha256hex(data) {
  return createHash('sha256').update(data).digest('hex')
}
function hmac(key, data) {
  return createHmac('sha256', key).update(data).digest()
}

async function putToR2(key, buffer, contentType) {
  const host    = `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  const now     = new Date()
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const dateStr = amzDate.slice(0, 8)

  const payloadHash   = sha256hex(buffer)
  const encodedKey    = key.split('/').map(s => encodeURIComponent(s)).join('/')
  const canonPath     = `/${R2_BUCKET}/${encodedKey}`
  const canonHeaders  = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'
  const canonRequest  = `PUT\n${canonPath}\n\n${canonHeaders}\n${signedHeaders}\n${payloadHash}`

  const credScope = `${dateStr}/auto/s3/aws4_request`
  const strToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credScope}\n${sha256hex(canonRequest)}`

  let sigKey = hmac(`AWS4${R2_SECRET_ACCESS_KEY}`, dateStr)
  sigKey = hmac(sigKey, 'auto')
  sigKey = hmac(sigKey, 's3')
  sigKey = hmac(sigKey, 'aws4_request')
  const signature = createHmac('sha256', sigKey).update(strToSign).digest('hex')

  const res = await fetch(`https://${host}${canonPath}`, {
    method: 'PUT',
    headers: {
      'Content-Type':          contentType,
      'Host':                  host,
      'X-Amz-Content-Sha256': payloadHash,
      'X-Amz-Date':           amzDate,
      'Authorization':         `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${credScope},SignedHeaders=${signedHeaders},Signature=${signature}`,
      'Cache-Control':         'public, max-age=31536000, immutable',
    },
    body: buffer,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`R2 PUT ${res.status}: ${text.slice(0, 200)}`)
  }
}

// ── Download from Supabase ─────────────────────────────────────────────────────
// Tries public URL first; falls back to authenticated URL with service role key.
async function downloadFromSupabase(storagePath) {
  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/Photos/${storagePath}`
  const authUrl   = `${SUPABASE_URL}/storage/v1/object/Photos/${storagePath}`

  // Try public (no auth) first
  let res = await fetch(publicUrl)
  if (!res.ok && res.status !== 404) {
    // Restricted — try with service role key
    res = await fetch(authUrl, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
      },
    })
  }
  if (!res.ok) throw new Error(`download ${res.status}: ${storagePath}`)

  const contentType = res.headers.get('content-type') ?? ''
  const buffer = Buffer.from(await res.arrayBuffer())
  return { buffer, contentType }
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function randomHex() {
  return Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
}

function guessMime(storagePath, mediaType) {
  const ext = extname(storagePath).toLowerCase()
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif',  '.webp': 'image/webp',  '.avif': 'image/avif',
    '.mp4': 'video/mp4',  '.mov': 'video/quicktime', '.webm': 'video/webm',
  }
  return map[ext] ?? (mediaType === 'video' ? 'video/mp4' : 'image/jpeg')
}

function sqlLiteral(s) {
  return `'${String(s).replace(/'/g, "''")}'`
}

function kb(bytes) { return `${(bytes / 1024).toFixed(0)} KB` }

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const csvArg = args.find(a => !a.startsWith('--'))

  if (!csvArg) {
    console.error('Usage: node scripts/migrate-supabase-to-r2.mjs <photos.csv> [--dry-run]')
    process.exit(1)
  }

  let csvText
  try {
    csvText = readFileSync(csvArg, 'utf8')
  } catch {
    console.error(`Cannot read CSV file: ${csvArg}`)
    process.exit(1)
  }

  const photos = parseCsv(csvText)
  console.log(`Loaded ${photos.length} rows from ${csvArg}`)
  if (dryRun) console.log('DRY RUN — nothing will be written or deleted\n')
  else console.log('')

  let passed = 0
  let failed = 0
  const failures = []
  const sqlLines = [
    '-- Generated by migrate-supabase-to-r2.mjs',
    `-- Run this in Supabase SQL Editor after confirming all photos load from R2`,
    '',
    'BEGIN;',
    '',
  ]

  for (let i = 0; i < photos.length; i++) {
    const photo  = photos[i]
    const prefix = `[${i + 1}/${photos.length}]`

    if (!photo.id || !photo.album_id || !photo.storage_path) {
      console.warn(`${prefix} SKIP — missing fields: ${JSON.stringify(photo)}`)
      continue
    }

    try {
      const filename   = basename(photo.storage_path)
      const newKey     = `${photo.album_id}/${randomHex()}/${filename}`
      const newUrl     = `https://${R2_PUBLIC_HOST}/${newKey}`
      const isImage    = photo.media_type === 'image'

      console.log(`${prefix} ${photo.storage_path}`)
      console.log(`        → ${newKey}`)

      if (!dryRun) {
        // 1. Download from Supabase storage
        const { buffer, contentType: rawCT } = await downloadFromSupabase(photo.storage_path)
        const contentType = rawCT.split(';')[0].trim() || guessMime(photo.storage_path, photo.media_type)
        console.log(`        ↓ ${kb(buffer.length)} [${contentType}]`)

        // 2. Upload to R2
        await putToR2(newKey, buffer, contentType)
      }

      // 3. Accumulate SQL UPDATE
      const setClause = isImage
        ? `storage_backend = 'r2', storage_path = ${sqlLiteral(newKey)}, url = ${sqlLiteral(newUrl)}, thumb_url = ${sqlLiteral(newUrl)}`
        : `storage_backend = 'r2', storage_path = ${sqlLiteral(newKey)}, url = ${sqlLiteral(newUrl)}`
      sqlLines.push(`UPDATE photos SET ${setClause} WHERE id = ${sqlLiteral(photo.id)};`)

      passed++
      console.log(`        ✓`)
    } catch (err) {
      failed++
      const msg = err instanceof Error ? err.message : String(err)
      failures.push(`${photo.storage_path}: ${msg}`)
      console.error(`        ✗ FAILED: ${msg}`)
    }
  }

  sqlLines.push('')
  sqlLines.push('COMMIT;')
  sqlLines.push('')
  sqlLines.push('-- ================================================================')
  sqlLines.push('-- ONLY run the block below AFTER verifying photos load from R2 ✓')
  sqlLines.push('-- This permanently deletes all files from Supabase storage.')
  sqlLines.push('-- ================================================================')
  sqlLines.push('-- DELETE FROM storage.objects WHERE bucket_id = \'Photos\';')

  const sqlOut = 'migrate-updates.sql'
  if (!dryRun) {
    writeFileSync(sqlOut, sqlLines.join('\n') + '\n', 'utf8')
    console.log(`\nSQL updates written to: ${sqlOut}`)
    console.log('Paste its contents into the Supabase SQL Editor and run.')
  }

  console.log(`\n────────────────────────────────────`)
  console.log(`Migrated: ${passed}  |  Failed: ${failed}  |  Total: ${photos.length}`)
  if (dryRun) console.log('(dry run — no files were uploaded)')
  if (failures.length) {
    console.log('\nFailed files:')
    failures.forEach(f => console.log('  -', f))
  }
}

main().catch(err => { console.error(err); process.exit(1) })

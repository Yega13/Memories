// Album password helpers. Uses PBKDF2-SHA256 via Web Crypto so it runs on
// Cloudflare Workers (the deployment target via @opennextjs/cloudflare) with
// no native dependencies.
//
// Storage format for `albums.password_hash`:
//   pbkdf2$<iterations>$<saltBase64>$<hashBase64>
//
// Versioning by prefix means we can switch to a stronger algorithm later
// without invalidating existing hashes — verify reads the algorithm from
// the prefix and dispatches.
//
// IMPORTANT: this is page-level protection. Photo and video URLs themselves
// remain publicly hosted on R2/Supabase Storage; this gate just hides the
// album listing from casual visitors. Real per-asset privacy needs signed
// URLs, which is a separate feature.

const ITERATIONS = 100_000
const KEY_BITS = 256

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2(password, salt, ITERATIONS)
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number.parseInt(parts[1], 10)
  if (!Number.isFinite(iterations) || iterations < 10_000) return false
  let salt: Uint8Array
  let expected: Uint8Array
  try {
    salt = fromBase64(parts[2])
    expected = fromBase64(parts[3])
  } catch {
    return false
  }
  const actual = await pbkdf2(password, salt, iterations)
  return timingSafeEqualBytes(actual, expected)
}

// Stable per-album access token derived from password_hash + albumId.
// Used as the cookie value after a successful verify. Rotates automatically
// when the owner changes the password (because the hash changes).
//
// We never put the password_hash itself in the cookie — that's the secret
// the verifier compares against, and exposing it would let an attacker
// brute-force offline.
export async function deriveAccessToken(passwordHash: string, albumId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passwordHash),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(albumId))
  return toBase64(new Uint8Array(sig))
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    KEY_BITS,
  )
  return new Uint8Array(bits)
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i]
  return r === 0
}

export const PASSWORD_COOKIE_PREFIX = 'hushare_pw_'
export const PASSWORD_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 days

export function cookieNameForAlbum(albumId: string): string {
  return `${PASSWORD_COOKIE_PREFIX}${albumId}`
}

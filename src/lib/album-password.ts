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

// PBKDF2-SHA256 iteration count for NEW hashes. OWASP 2024 recommends
// 600,000 for SHA-256. Old hashes saved with smaller counts still verify
// because the prefix records the count we used at hash time.
const ITERATIONS = 600_000
const KEY_BITS = 256
// Minimum acceptable iteration count when verifying. Refuse to honour a
// hash with absurdly low work — protects against a hypothetical future bug
// where someone wrote a too-cheap value into the column.
const MIN_VERIFY_ITERATIONS = 50_000

// Minimum password length enforced at write time. Anything shorter has too
// small a keyspace to survive a determined attacker even with rate limits.
export const MIN_PASSWORD_LEN = 6
export const MAX_PASSWORD_LEN = 128

export async function hashPassword(password: string): Promise<string> {
  const salt: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(16))
  const hash = await pbkdf2(password, salt, ITERATIONS)
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number.parseInt(parts[1], 10)
  if (!Number.isFinite(iterations) || iterations < MIN_VERIFY_ITERATIONS) return false
  let salt: Uint8Array<ArrayBuffer>
  let expected: Uint8Array<ArrayBuffer>
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

// Note on type signatures: every Uint8Array here is annotated as
// `Uint8Array<ArrayBuffer>` (rather than the default `Uint8Array<ArrayBufferLike>`).
// TS 5.7's `BufferSource` rejects the wider `ArrayBufferLike` because it would
// allow `SharedArrayBuffer`, which Web Crypto refuses at runtime.
async function pbkdf2(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
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

function toBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s)
}

function fromBase64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function timingSafeEqualBytes(a: Uint8Array<ArrayBuffer>, b: Uint8Array<ArrayBuffer>): boolean {
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

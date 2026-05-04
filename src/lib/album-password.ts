
const HASH_VERSION = 'hmac-sha256-v1'
const KEY_BITS = 256
const MIN_VERIFY_ITERATIONS = 50_000

export const MIN_PASSWORD_LEN = 6
export const MAX_PASSWORD_LEN = 128

export async function hashPassword(password: string): Promise<string> {
  const salt: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(16))
  const hash = await hmacPassword(password, salt)
  return `${HASH_VERSION}$${toBase64(salt)}$${toBase64(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length === 3 && parts[0] === HASH_VERSION) {
    let salt: Uint8Array<ArrayBuffer>
    let expected: Uint8Array<ArrayBuffer>
    try {
      salt = fromBase64(parts[1])
      expected = fromBase64(parts[2])
    } catch {
      return false
    }
    for (const pepper of passwordPeppers()) {
      const actual = await hmacPassword(password, salt, pepper)
      if (timingSafeEqualBytes(actual, expected)) return true
    }
    return false
  }

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

async function hmacPassword(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  pepper = passwordPeppers()[0],
): Promise<Uint8Array<ArrayBuffer>> {
  if (!pepper) throw new Error('No password pepper configured')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const message = new TextEncoder().encode(`${toBase64(salt)}:${password}`)
  const sig = await crypto.subtle.sign('HMAC', key, message)
  return new Uint8Array(sig)
}

function passwordPeppers(): string[] {
  const peppers = [
    process.env.ALBUM_PASSWORD_PEPPER ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.POLAR_WEBHOOK_SECRET,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.POLAR_WEBHOOK_SECRET,
  ].filter((value): value is string => Boolean(value))
  return Array.from(new Set(peppers))
}

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
export const PASSWORD_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30

export function cookieNameForAlbum(albumId: string): string {
  return `${PASSWORD_COOKIE_PREFIX}${albumId}`
}

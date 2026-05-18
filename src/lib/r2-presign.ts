// Generates presigned PUT URLs for direct browser→R2 uploads via S3-compatible API.
// Bypasses Cloudflare Workers' 100 MB request body limit for large video uploads.
// Requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY env vars.

const enc = new TextEncoder()

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(data: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(data)))
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const keyBuf = key instanceof Uint8Array
    ? key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer
    : key as ArrayBuffer
  const k = await crypto.subtle.importKey('raw', keyBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, enc.encode(data))
}

export function r2PresignConfigured(): boolean {
  return !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)
}

export async function generateR2PresignedPut(
  objectKey: string,
  contentType: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const accountId = process.env.R2_ACCOUNT_ID ?? ''
  const accessKey = process.env.R2_ACCESS_KEY_ID ?? ''
  const secretKey = process.env.R2_SECRET_ACCESS_KEY ?? ''
  const bucket = 'hushare-videos'
  const region = 'auto'
  const service = 's3'
  const host = `${accountId}.r2.cloudflarestorage.com`

  const now = new Date()
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const dateStr = amzDate.slice(0, 8)
  const credScope = `${dateStr}/${region}/${service}/aws4_request`

  // Query parameters for presigned URL, sorted alphabetically (required by SigV4)
  const qp = ([
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKey}/${credScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresInSeconds)],
    ['X-Amz-SignedHeaders', 'content-type;host'],
  ] as [string, string][]).sort(([a], [b]) => a.localeCompare(b))

  const queryString = qp
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')

  const canonRequest = [
    'PUT',
    `/${bucket}/${objectKey}`,
    queryString,
    `content-type:${contentType}\nhost:${host}\n`,
    'content-type;host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')

  const strToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credScope,
    await sha256Hex(canonRequest),
  ].join('\n')

  let sigKey = await hmacSha256(enc.encode('AWS4' + secretKey), dateStr)
  sigKey = await hmacSha256(sigKey, region)
  sigKey = await hmacSha256(sigKey, service)
  sigKey = await hmacSha256(sigKey, 'aws4_request')
  const signature = toHex(await hmacSha256(sigKey, strToSign))

  return `https://${host}/${bucket}/${objectKey}?${queryString}&X-Amz-Signature=${signature}`
}

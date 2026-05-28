// AWS Signature V4 presigned URL generation for Cloudflare R2's S3-compatible API.
// Signing primitives copied from rekognition.ts — Web Crypto only, no Node.js dependencies.
// R2 uses region "auto" and service "s3" with endpoint {accountId}.r2.cloudflarestorage.com.

const enc = new TextEncoder()

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(data: string): Promise<string> {
  const bytes = typeof Buffer !== 'undefined' ? Buffer.from(data, 'utf-8') : enc.encode(data)
  return toHex(await crypto.subtle.digest('SHA-256', bytes))
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const keyBuf: ArrayBuffer = key instanceof Uint8Array
    ? key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer
    : key as ArrayBuffer
  const k = await crypto.subtle.importKey('raw', keyBuf, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, enc.encode(data))
}

function pct(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

// Generates a presigned PUT URL for one part of an R2 multipart upload.
// The browser can PUT the chunk bytes directly to the returned URL — the Worker
// is not in the data path and never buffers the chunk in RAM.
export async function presignR2UploadPart(opts: {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  key: string
  uploadId: string
  partNumber: number
  expiresInSeconds?: number
}): Promise<string> {
  const { accountId, accessKeyId, secretAccessKey, bucket, key, uploadId, partNumber, expiresInSeconds = 3600 } = opts

  const host = `${accountId}.r2.cloudflarestorage.com`
  const now = new Date()
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const dateStr = amzDate.slice(0, 8)
  const credScope = `${dateStr}/auto/s3/aws4_request`
  const credential = `${accessKeyId}/${credScope}`

  // Query params must be sorted by byte value (uppercase before lowercase in ASCII).
  // X (0x58) < p (0x70) < u (0x75), so X-Amz-* come first.
  const queryParams: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', credential],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresInSeconds)],
    ['X-Amz-SignedHeaders', 'host'],
    ['partNumber', String(partNumber)],
    ['uploadId', uploadId],
  ]
  queryParams.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  const canonQS = queryParams.map(([k, v]) => `${pct(k)}=${pct(v)}`).join('&')

  // Each key segment is individually percent-encoded; slashes between segments are preserved.
  const canonUri = `/${bucket}/${key.split('/').map(pct).join('/')}`

  // Only 'host' is signed for presigned PUT URLs. Payload is UNSIGNED-PAYLOAD.
  const canonRequest = ['PUT', canonUri, canonQS, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const strToSign = ['AWS4-HMAC-SHA256', amzDate, credScope, await sha256Hex(canonRequest)].join('\n')

  let sigKey = await hmacSha256(enc.encode('AWS4' + secretAccessKey), dateStr)
  sigKey = await hmacSha256(sigKey, 'auto')
  sigKey = await hmacSha256(sigKey, 's3')
  sigKey = await hmacSha256(sigKey, 'aws4_request')
  const signature = toHex(await hmacSha256(sigKey, strToSign))

  return `https://${host}${canonUri}?${canonQS}&X-Amz-Signature=${signature}`
}

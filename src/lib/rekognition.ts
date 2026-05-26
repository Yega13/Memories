// Direct Rekognition API via fetch + AWS Signature V4 using Web Crypto.
// Replaces @aws-sdk/client-rekognition which imports Node.js `fs` and crashes in Workers.

const enc = new TextEncoder()

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(data: string): Promise<string> {
  // Buffer.from is faster than TextEncoder.encode for large strings under nodejs_compat.
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

async function deriveSigningKey(secret: string, date: string, region: string): Promise<ArrayBuffer> {
  let key = await hmacSha256(enc.encode('AWS4' + secret), date)
  key = await hmacSha256(key, region)
  key = await hmacSha256(key, 'rekognition')
  return hmacSha256(key, 'aws4_request')
}

function uint8ToBase64(bytes: Uint8Array): string {
  // Node.js Buffer (available via wrangler's nodejs_compat flag) converts to base64 in C++
  // without building an intermediate binary string, making it 5-10× faster than the btoa path
  // for large images. This is critical on Cloudflare Workers where CPU time is metered.
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength).toString('base64')
  }
  // Fallback for environments without Buffer
  const CHUNK = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

async function rekognitionPost(operation: string, body: unknown): Promise<unknown> {
  // eu-west-1 (Ireland) is the default — eu-north-1 doesn't have Rekognition
  const region = process.env.AWS_REGION ?? 'eu-west-1'
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? ''
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? ''

  const bodyStr = JSON.stringify(body)
  const host = `rekognition.${region}.amazonaws.com`
  const url = `https://${host}/`

  const now = new Date()
  // Format: 20240101T120000Z
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '').slice(0, 15) + 'Z'
  const dateStr = amzDate.slice(0, 8)
  const target = `RekognitionService.${operation}`

  const canonHeaders =
    `content-type:application/x-amz-json-1.1\n` +
    `host:${host}\n` +
    `x-amz-date:${amzDate}\n` +
    `x-amz-target:${target}\n`
  const signedHeaders = 'content-type;host;x-amz-date;x-amz-target'

  const canonRequest = [
    'POST', '/', '',
    canonHeaders,
    signedHeaders,
    await sha256Hex(bodyStr),
  ].join('\n')

  const credScope = `${dateStr}/${region}/rekognition/aws4_request`
  const strToSign = ['AWS4-HMAC-SHA256', amzDate, credScope, await sha256Hex(canonRequest)].join('\n')

  const sigKey = await deriveSigningKey(secretAccessKey, dateStr, region)
  const signature = toHex(await hmacSha256(sigKey, strToSign))

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Date': amzDate,
      'X-Amz-Target': target,
      Authorization: authorization,
    },
    body: bodyStr,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    let name = 'RekognitionError'
    let message = `HTTP ${res.status}`
    try {
      const err = JSON.parse(text) as { __type?: string; message?: string; Message?: string }
      name = (err.__type ?? '').split('#').pop() ?? name
      message = err.message ?? err.Message ?? message
    } catch { /* non-JSON error body */ }
    throw Object.assign(new Error(message), { name })
  }

  return res.json() as Promise<unknown>
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function collectionId(albumId: string) {
  return `hushare-${albumId}`
}

export async function ensureCollection(albumId: string) {
  try {
    await rekognitionPost('CreateCollection', { CollectionId: collectionId(albumId) })
  } catch (err: unknown) {
    if ((err as { name?: string }).name !== 'ResourceAlreadyExistsException') throw err
  }
}

export async function indexPhotoFaces(albumId: string, photoId: string, imageUrl: string): Promise<string[]> {
  const imgRes = await fetch(imageUrl)
  if (!imgRes.ok) throw new Error(`Failed to fetch image: ${imgRes.status}`)
  const base64Image = uint8ToBase64(new Uint8Array(await imgRes.arrayBuffer()))

  type IndexResult = { FaceRecords?: Array<{ Face?: { FaceId?: string } }> }
  const result = await rekognitionPost('IndexFaces', {
    CollectionId: collectionId(albumId),
    Image: { Bytes: base64Image },
    ExternalImageId: photoId,
    DetectionAttributes: [],
    MaxFaces: 15,
    QualityFilter: 'AUTO',
  }) as IndexResult

  return (result.FaceRecords ?? [])
    .map(r => r.Face?.FaceId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

export async function searchFacesByImage(
  albumId: string,
  selfieBytes: Uint8Array,
  threshold = 80,
): Promise<{ photoId: string; similarity: number }[]> {
  type SearchResult = {
    FaceMatches?: Array<{ Face?: { ExternalImageId?: string }; Similarity?: number }>
  }
  const result = await rekognitionPost('SearchFacesByImage', {
    CollectionId: collectionId(albumId),
    Image: { Bytes: uint8ToBase64(selfieBytes) },
    MaxFaces: 100,
    FaceMatchThreshold: threshold,
  }) as SearchResult

  const seen = new Set<string>()
  const matches: { photoId: string; similarity: number }[] = []
  for (const match of result.FaceMatches ?? []) {
    const photoId = match.Face?.ExternalImageId
    const similarity = match.Similarity ?? 0
    if (photoId && !seen.has(photoId)) {
      seen.add(photoId)
      matches.push({ photoId, similarity })
    }
  }
  return matches.sort((a, b) => b.similarity - a.similarity)
}

export async function deleteFaces(albumId: string, faceIds: string[]) {
  if (!faceIds.length) return
  // Rekognition caps DeleteFaces at 4096 IDs per call — chunk just in case (paranoid but cheap).
  const CHUNK = 4000
  for (let i = 0; i < faceIds.length; i += CHUNK) {
    await rekognitionPost('DeleteFaces', {
      CollectionId: collectionId(albumId),
      FaceIds: faceIds.slice(i, i + CHUNK),
    })
  }
}

// Removes the entire Rekognition collection for an album. Called on album delete to clean up
// all indexed faces in one shot (avoids paginating through DeleteFaces).
export async function deleteCollection(albumId: string) {
  try {
    await rekognitionPost('DeleteCollection', { CollectionId: collectionId(albumId) })
  } catch (err: unknown) {
    // ResourceNotFoundException means it never existed (no faces were ever indexed). Ignore.
    if ((err as { name?: string }).name !== 'ResourceNotFoundException') throw err
  }
}

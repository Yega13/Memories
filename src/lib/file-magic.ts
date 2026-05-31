import { fileTypeFromBuffer } from 'file-type'

const ALLOWED_MIMES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/ogg',
  'video/x-m4v',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
  'image/heic',
  'image/heif',
])

/**
 * Verify that the actual file bytes match the declared MIME type.
 * Reads only the first 4100 bytes — enough for file-type detection.
 * Returns false if magic bytes don't match or the type is not on the allowlist,
 * regardless of what the browser reported in file.type.
 */
export async function verifyMimeByMagic(blob: Blob, declaredMime: string): Promise<boolean> {
  if (!ALLOWED_MIMES.has(declaredMime)) return false
  const buffer = await blob.slice(0, 4100).arrayBuffer()
  const result = await fileTypeFromBuffer(new Uint8Array(buffer))
  if (!result) return false
  // file-type returns 'video/quicktime' for both .mov and some .mp4 containers
  return (
    result.mime === declaredMime ||
    (declaredMime === 'video/mp4' && result.mime === 'video/quicktime')
  )
}

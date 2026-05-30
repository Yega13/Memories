// Pure-JS JPEG EXIF stripper. Works in both browser and Cloudflare Workers (no Node.js deps).
// Walks JPEG segment list and drops all metadata-bearing segments:
//   APP1 (0xE1) — EXIF + XMP (GPS, camera make/model, timestamps)
//   APP2 (0xE2) — ICC profile
//   APP3..APP15 (0xE3..0xEF) — IPTC, Photoshop info, Adobe metadata, vendor extras
//   COM (0xFE) — JPEG comments
// Keeps APP0 (JFIF) for compatibility. Structural markers (DQT, DHT, SOFn, SOS, EOI) are kept.
export function stripExifFromJpeg(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
  const keep: Uint8Array[] = [bytes.subarray(0, 2)]
  let i = 2
  while (i < bytes.length - 1) {
    while (i < bytes.length - 1 && bytes[i] === 0xff && bytes[i + 1] === 0xff) i++
    if (i >= bytes.length - 1 || bytes[i] !== 0xff) break
    const marker = bytes[i + 1]
    if (marker === 0xda) {
      keep.push(bytes.subarray(i))
      break
    }
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      keep.push(bytes.subarray(i, i + 2))
      i += 2
      continue
    }
    if (i + 4 > bytes.length) break
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3]
    if (segLen < 2) break
    const segEnd = i + 2 + segLen
    if (segEnd > bytes.length) break
    const isAppMetadata = marker >= 0xe1 && marker <= 0xef
    const isComment = marker === 0xfe
    if (!isAppMetadata && !isComment) {
      keep.push(bytes.subarray(i, segEnd))
    }
    i = segEnd
  }
  const total = keep.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of keep) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

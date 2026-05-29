import { createHash, timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto'

function hashForCompare(s: string): Buffer {
  return createHash('sha256').update(s).digest()
}

export function timingSafeEqual(a: string, b: string): boolean {
  return cryptoTimingSafeEqual(hashForCompare(a), hashForCompare(b))
}

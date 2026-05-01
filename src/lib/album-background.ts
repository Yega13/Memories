const COLOR_RE = /^#[0-9a-f]{6}$/i

export const STOCK_BACKGROUND_VALUES = new Set([
  'image:/wedding.jpg',
  'image:/card1.jpg',
  'image:/card2.jpg',
  'image:/card3.jpg',
  'image:/children.avif',
])

export function normalizeAlbumBackground(input: unknown): string | null {
  if (input === null || input === undefined || input === '') return null
  if (typeof input !== 'string') return null
  const value = input.trim()
  if (COLOR_RE.test(value)) return value.toUpperCase()
  if (STOCK_BACKGROUND_VALUES.has(value)) return value
  return null
}

export function isValidAlbumBackground(input: unknown): boolean {
  if (input === null || input === undefined || input === '') return true
  return normalizeAlbumBackground(input) !== null
}

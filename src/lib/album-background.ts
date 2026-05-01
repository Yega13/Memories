import { STOCK_ALBUM_BACKGROUND_VALUES } from './album-backgrounds'

const COLOR_RE = /^#[0-9a-f]{6}$/i

export const STOCK_BACKGROUND_VALUES = STOCK_ALBUM_BACKGROUND_VALUES

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

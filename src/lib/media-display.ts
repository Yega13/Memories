export type MediaDisplayFilter = 'none' | 'warm' | 'cool' | 'mono' | 'vintage' | 'soft'

export const MIN_MEDIA_RADIUS = 0
export const MAX_MEDIA_RADIUS = 10000

export const MEDIA_DISPLAY_FILTER_OPTIONS: Array<{ value: MediaDisplayFilter; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'warm', label: 'Warm' },
  { value: 'cool', label: 'Cool' },
  { value: 'mono', label: 'Mono' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'soft', label: 'Soft' },
]

const MEDIA_DISPLAY_FILTERS = new Set<MediaDisplayFilter>(
  MEDIA_DISPLAY_FILTER_OPTIONS.map((option) => option.value),
)

export function isMediaDisplayFilter(value: unknown): value is MediaDisplayFilter {
  return typeof value === 'string' && MEDIA_DISPLAY_FILTERS.has(value as MediaDisplayFilter)
}

export function clampMediaRadius(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  return Math.max(MIN_MEDIA_RADIUS, Math.min(MAX_MEDIA_RADIUS, Math.round(numeric)))
}

export function cssMediaDisplayFilter(filter: MediaDisplayFilter | null | undefined): string {
  switch (filter) {
    case 'warm':
      return 'sepia(0.18) saturate(1.12) contrast(1.02)'
    case 'cool':
      return 'saturate(1.05) hue-rotate(8deg) contrast(1.02)'
    case 'mono':
      return 'grayscale(1) contrast(1.04)'
    case 'vintage':
      return 'sepia(0.32) saturate(0.92) contrast(1.08)'
    case 'soft':
      return 'saturate(0.94) brightness(1.04) contrast(0.94)'
    default:
      return 'none'
  }
}

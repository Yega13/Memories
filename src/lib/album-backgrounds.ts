export type StockAlbumBackground = {
  label: string
  value: `stock:pexels-${string}`
  src: string
  legacyValue?: `image:${string}`
  imageValue?: `image:/backgrounds/${string}.svg`
}

function pexelsBackground(photoId: string, label: string): StockAlbumBackground {
  const src = `https://images.pexels.com/photos/${photoId}/pexels-photo-${photoId}.jpeg?auto=compress&cs=tinysrgb&w=1800`
  return {
    label,
    value: `stock:pexels-${photoId}`,
    src,
    legacyValue: `image:${src}`,
    imageValue: `image:/backgrounds/pexels-${photoId}.svg`,
  }
}

export const STOCK_ALBUM_BACKGROUNDS: StockAlbumBackground[] = [
  pexelsBackground('36391026', 'Bright desk'),
  pexelsBackground('37199912', 'Quiet celebration'),
  pexelsBackground('34077030', 'Soft table'),
  pexelsBackground('37196479', 'Minimal room'),
  pexelsBackground('36821284', 'Warm detail'),
  pexelsBackground('37295912', 'Clean morning'),
  pexelsBackground('36025761', 'Open air'),
  pexelsBackground('17893018', 'Gentle flowers'),
  pexelsBackground('37298146', 'Calm light'),
  pexelsBackground('36546519', 'Neutral corner'),
  pexelsBackground('29207389', 'Soft landscape'),
  pexelsBackground('37173058', 'Event detail'),
  pexelsBackground('37223904', 'Fresh texture'),
  pexelsBackground('36862789', 'Warm minimal'),
  pexelsBackground('33443600', 'Quiet wall'),
  pexelsBackground('20954747', 'Natural light'),
  pexelsBackground('30502888', 'Soft green'),
  pexelsBackground('5477719', 'Paper moment'),
  pexelsBackground('8099498', 'Garden table'),
  pexelsBackground('8489990', 'Cream texture'),
  pexelsBackground('7966020', 'Simple flowers'),
  pexelsBackground('5477682', 'Muted detail'),
  pexelsBackground('20216572', 'Still morning'),
  pexelsBackground('32289804', 'Open sky'),
  pexelsBackground('34256467', 'Soft pattern'),
]

export const STOCK_ALBUM_BACKGROUND_VALUES: ReadonlySet<string> = new Set(
  STOCK_ALBUM_BACKGROUNDS.flatMap((background) =>
    [background.value, background.legacyValue, background.imageValue].filter((value): value is NonNullable<typeof value> => Boolean(value)),
  ),
)

const STOCK_ALBUM_BACKGROUND_SRC_BY_VALUE = new Map<string, string>(
  STOCK_ALBUM_BACKGROUNDS.flatMap((background) =>
    [background.value, background.legacyValue, background.imageValue]
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .map((value) => [value, background.src] as [string, string]),
  ),
)

const STOCK_ALBUM_BACKGROUND_STORAGE_BY_VALUE = new Map<string, string>(
  STOCK_ALBUM_BACKGROUNDS.flatMap((background) =>
    [background.value, background.legacyValue, background.imageValue]
      .filter((value): value is NonNullable<typeof value> => Boolean(value))
      .map((value) => [value, background.imageValue ?? background.value] as [string, string]),
  ),
)

export function canonicalStockAlbumBackgroundValue(value: string): string | null {
  return STOCK_ALBUM_BACKGROUND_STORAGE_BY_VALUE.get(value) ?? null
}

// Only URLs from these origins are allowed as custom album backgrounds.
// An arbitrary user-stored 'image:...' value is injected into a CSS url() expression,
// so we must reject anything not in this allowlist to prevent CSS injection.
const ALLOWED_BG_URL_PREFIXES = [
  'https://images.pexels.com/',
  'https://lteovnkplhowfvbzpalp.supabase.co/storage/v1/object/public/',
]

export function resolveAlbumBackgroundImage(value: string): string {
  if (value.startsWith('stock:')) return STOCK_ALBUM_BACKGROUND_SRC_BY_VALUE.get(value) ?? ''
  const mapped = STOCK_ALBUM_BACKGROUND_SRC_BY_VALUE.get(value)
  if (mapped) return mapped
  const raw = value.slice('image:'.length)
  if (!ALLOWED_BG_URL_PREFIXES.some((prefix) => raw.startsWith(prefix))) return ''
  return raw
}

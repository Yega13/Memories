export type StockAlbumBackground = {
  label: string
  value: `image:${string}`
  src: string
}

function pexelsBackground(photoId: string, label: string): StockAlbumBackground {
  const src = `https://images.pexels.com/photos/${photoId}/pexels-photo-${photoId}.jpeg?auto=compress&cs=tinysrgb&w=1800`
  return { label, value: `image:${src}`, src }
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
  STOCK_ALBUM_BACKGROUNDS.map((background) => background.value),
)

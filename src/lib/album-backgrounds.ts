export type StockAlbumBackground = {
  label: string
  value: `image:/${string}`
  src: `/${string}`
}

export const STOCK_ALBUM_BACKGROUNDS: StockAlbumBackground[] = [
  { label: 'Wedding', value: 'image:/wedding.jpg', src: '/wedding.jpg' },
  { label: 'Trail', value: 'image:/card1.jpg', src: '/card1.jpg' },
  { label: 'Golden', value: 'image:/card2.jpg', src: '/card2.jpg' },
  { label: 'Lake', value: 'image:/card3.jpg', src: '/card3.jpg' },
  { label: 'Explorers', value: 'image:/children.avif', src: '/children.avif' },
  { label: 'Soft linen', value: 'image:/backgrounds/minimal-linen.svg', src: '/backgrounds/minimal-linen.svg' },
  { label: 'Sage wash', value: 'image:/backgrounds/minimal-sage.svg', src: '/backgrounds/minimal-sage.svg' },
  { label: 'Quiet sky', value: 'image:/backgrounds/minimal-sky.svg', src: '/backgrounds/minimal-sky.svg' },
  { label: 'Warm clay', value: 'image:/backgrounds/minimal-clay.svg', src: '/backgrounds/minimal-clay.svg' },
  { label: 'Paper light', value: 'image:/backgrounds/minimal-paper.svg', src: '/backgrounds/minimal-paper.svg' },
  { label: 'Rose mist', value: 'image:/backgrounds/minimal-rose.svg', src: '/backgrounds/minimal-rose.svg' },
  { label: 'Stone calm', value: 'image:/backgrounds/minimal-stone.svg', src: '/backgrounds/minimal-stone.svg' },
  { label: 'Dawn veil', value: 'image:/backgrounds/minimal-dawn.svg', src: '/backgrounds/minimal-dawn.svg' },
]

export const STOCK_ALBUM_BACKGROUND_VALUES: ReadonlySet<string> = new Set(
  STOCK_ALBUM_BACKGROUNDS.map((background) => background.value),
)

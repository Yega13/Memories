import BrandPreloader from '@/components/BrandPreloader'

export const metadata = {
  title: 'Preloader Preview - Hushare',
  robots: {
    index: false,
    follow: false,
  },
}

export default function PreloaderPreviewPage() {
  return <BrandPreloader label="Previewing preloader" />
}

import Image from 'next/image'

type Props = {
  label?: string
}

export default function BrandPreloader({ label = 'Loading' }: Props) {
  return (
    <div className="hush-brand-preloader" role="status" aria-live="polite" aria-label={label}>
      <div className="hush-brand-preloader-mark">
        <Image
          src="/logo/logo-icon-dark-transparent.png"
          alt=""
          width={96}
          height={96}
          priority
          aria-hidden="true"
        />
      </div>
      <Image
        src="/logo/logo-dark-transparent.png"
        alt="Hushare"
        width={618}
        height={146}
        priority
        className="hush-brand-preloader-logo"
      />
      <span className="sr-only">{label}</span>
    </div>
  )
}

import Image from 'next/image'

type Props = {
  label?: string
}

export default function BrandPreloader({ label = 'Loading' }: Props) {
  return (
    <div className="hush-brand-preloader" role="status" aria-live="polite" aria-label={label}>
      <div className="hush-logo-build" aria-hidden="true">
        <Image
          src="/logo/logo-dark-transparent.png"
          alt=""
          width={618}
          height={146}
          priority
          className="hush-logo-build-base"
        />
        <Image
          src="/logo/logo-dark-transparent.png"
          alt=""
          width={618}
          height={146}
          priority
          className="hush-logo-build-fill"
        />
        <span className="hush-logo-build-line" />
      </div>
      <span className="sr-only">{label}</span>
    </div>
  )
}

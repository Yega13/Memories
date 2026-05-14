import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import AccountNavLink from "@/components/AccountNavLink";
import { ArrowUpRight } from "lucide-react";

export const runtime = "nodejs";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hushare.space";

const PAGE_TITLE = "Collabs";
const PAGE_DESCRIPTION =
  "Artists and creators who use Hushare to collect fan photos, document their work, and share memories from their events.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/collabs" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/collabs`,
    title: `${PAGE_TITLE} - Hushare`,
    description: PAGE_DESCRIPTION,
    siteName: "Hushare",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${PAGE_TITLE} - Hushare`,
    description: PAGE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large" },
  },
};

const SERIF = { fontFamily: "var(--font-serif)" } as const;

const collabs = [
  {
    name: "Tali Golergant",
    origin: "Luxembourg",
    flag: "🇱🇺",
    role: "Singer & Artist",
    description:
      "Tali Golergant is a Luxembourgish singer whose music bridges pop and soul with deeply personal storytelling. She uses Hushare at her concerts and events so fans can contribute their own photos — building a shared visual memory of every show.",
    photo: "/collabs/tali-golergant.jpg",
    photoAlt: "Tali Golergant",
    href: "https://taligolergant.com/husahre-collab/",
    hrefLabel: "See the collab",
  },
];

export default function CollabsPage() {
  return (
    <main className="min-h-screen" style={{ background: "#FDFAF5" }}>
      {/* Nav */}
      <nav className="hush-container-xl hush-nav">
        <Link href="/" aria-label="Hushare home">
          <Image
            src="/logo/logo-dark-transparent.png"
            alt="Hushare"
            width={618}
            height={146}
            className="hush-logo"
            style={{ width: "auto" }}
            draggable={false}
          />
        </Link>
        <div className="hush-nav-links">
          <Link href="/pricing" className="text-sm font-medium hover:underline" style={{ color: "#254F22" }}>
            Pricing
          </Link>
          <Link href="/support" className="text-sm font-medium hover:underline" style={{ color: "#254F22" }}>
            Support
          </Link>
          <AccountNavLink />
        </div>
      </nav>

      {/* Hero */}
      <section className="hush-readable hush-fade-up pt-12 sm:pt-20 pb-10 text-center">
        <p
          className="text-xs sm:text-sm font-medium uppercase mb-4"
          style={{ color: "#8B6F4E", letterSpacing: "0.18em" }}
        >
          Collabs
        </p>
        <h1
          className="text-3xl sm:text-4xl md:text-5xl font-bold mb-5 leading-tight"
          style={{ ...SERIF, color: "#254F22" }}
        >
          Artists who trust Hushare
        </h1>
        <p
          className="text-base sm:text-lg max-w-xl mx-auto leading-relaxed"
          style={{ color: "#5C4A3C" }}
        >
          These artists use Hushare to let fans and guests contribute their own photos — turning every event into a shared album.
        </p>
      </section>

      {/* Collab cards */}
      <section className="hush-container-xl pb-24">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 max-w-5xl mx-auto">
          {collabs.map((collab) => (
            <article
              key={collab.name}
              className="hush-reveal flex flex-col rounded-[20px] overflow-hidden"
              style={{
                background: "#FFFFFF",
                border: "1px solid #E8E0D0",
                boxShadow: "0 4px 24px rgba(37,79,34,0.07)",
              }}
            >
              {/* Photo */}
              <div
                className="relative w-full"
                style={{ aspectRatio: "4/3", background: "#E8E0D2" }}
              >
                <Image
                  src={collab.photo}
                  alt={collab.photoAlt}
                  fill
                  className="object-cover object-top"
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                />
              </div>

              {/* Content */}
              <div className="flex flex-col flex-1 p-6 gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xl" aria-hidden="true">{collab.flag}</span>
                    <span className="text-xs font-medium uppercase" style={{ color: "#8B6F4E", letterSpacing: "0.14em" }}>
                      {collab.origin} · {collab.role}
                    </span>
                  </div>
                  <h2
                    className="text-xl font-bold leading-snug"
                    style={{ ...SERIF, color: "#254F22" }}
                  >
                    {collab.name}
                  </h2>
                </div>

                <p className="text-sm leading-relaxed flex-1" style={{ color: "#5C4A3C" }}>
                  {collab.description}
                </p>

                <a
                  href={collab.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold transition hover:opacity-75 mt-auto"
                  style={{ color: "#254F22" }}
                >
                  {collab.hrefLabel}
                  <ArrowUpRight className="w-4 h-4" />
                </a>
              </div>
            </article>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-20 text-center">
          <div
            className="inline-block rounded-2xl px-8 py-8 max-w-lg"
            style={{ background: "#EDF3EC", border: "1px solid rgba(37,79,34,0.15)" }}
          >
            <h2
              className="text-xl font-bold mb-3"
              style={{ ...SERIF, color: "#254F22" }}
            >
              Are you an artist or creator?
            </h2>
            <p className="text-sm leading-relaxed mb-5" style={{ color: "#5C4A3C" }}>
              If you use Hushare at your events and want to be featured here, reach out.
            </p>
            <a
              href="mailto:husharesupport@gmail.com"
              className="inline-block rounded-xl px-5 py-2.5 text-sm font-semibold transition hover:opacity-90"
              style={{ background: "#254F22", color: "#FDFAF5" }}
            >
              Get in touch
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}

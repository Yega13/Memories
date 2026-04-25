import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MessageCircle, Clock } from "lucide-react";
import SupportForm from "./SupportForm";

export const runtime = "nodejs";

const SITE_URL = "https://hushare.space";
const SUPPORT_EMAIL = "hello@hushare.space";

const PAGE_TITLE = "Support";
const PAGE_DESCRIPTION =
  "Get help with your Hushare album. Send a message, find answers to common questions, or email us directly — we usually reply within one business day.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/support" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/support`,
    title: `${PAGE_TITLE} · Hushare`,
    description: PAGE_DESCRIPTION,
    siteName: "Hushare",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: `${PAGE_TITLE} · Hushare`,
    description: PAGE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
    },
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
        {
          "@type": "ListItem",
          position: 2,
          name: "Support",
          item: `${SITE_URL}/support`,
        },
      ],
    },
    {
      "@type": "ContactPage",
      "@id": `${SITE_URL}/support#contactpage`,
      url: `${SITE_URL}/support`,
      name: `${PAGE_TITLE} · Hushare`,
      description: PAGE_DESCRIPTION,
      inLanguage: "en",
      isPartOf: { "@id": `${SITE_URL}#website` },
    },
  ],
};

const SERIF = { fontFamily: "var(--font-serif)" } as const;
const INK = { color: "#254F22" } as const;

const helpCards = [
  {
    icon: MessageCircle,
    title: "Common questions",
    body: "Most answers — pricing, privacy, photo retention, lost owner links — live on the home page FAQ and the pricing page.",
    href: "/#faq",
    cta: "Browse the FAQ",
  },
  {
    icon: Mail,
    title: "Email us directly",
    body: "Prefer your own email client? Write to us anytime. We read every message.",
    href: `mailto:${SUPPORT_EMAIL}`,
    cta: SUPPORT_EMAIL,
  },
  {
    icon: Clock,
    title: "When we reply",
    body: "Usually within one business day, often faster. Studio subscribers get priority within 24 hours, weekends included.",
    href: "/pricing",
    cta: "See plans",
  },
];

export default function SupportPage() {
  return (
    <main
      className="min-h-screen"
      style={{ background: "#FDFAF5", fontFamily: "var(--font-sans)" }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Nav */}
      <nav
        className="sticky top-0 z-50 flex items-center justify-between px-5 sm:px-8 py-5"
        style={{
          background: "rgba(253, 250, 245, 0.85)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(221, 213, 197, 0.5)",
        }}
      >
        <Link href="/" className="flex items-center" aria-label="Hushare home">
          <img
            src="/logo/logo-dark-transparent.png"
            alt="Hushare"
            width={618}
            height={146}
            style={{ height: "28px", width: "auto" }}
          />
        </Link>
        <Link
          href="/"
          className="text-sm font-medium hover:underline"
          style={{ color: "#7C5C3E" }}
        >
          ← Back to home
        </Link>
      </nav>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-5 sm:px-8 pt-12 sm:pt-20 pb-8 text-center">
        <p
          className="text-xs sm:text-sm font-medium uppercase mb-4"
          style={{ color: "#8B6F4E", letterSpacing: "0.18em" }}
        >
          Support
        </p>
        <h1
          style={{
            ...SERIF,
            ...INK,
            fontSize: "clamp(2.2rem, 6vw, 3.4rem)",
            lineHeight: 1.1,
            fontWeight: 700,
          }}
        >
          We're here<br />
          <em style={{ color: "#7C4A2D" }}>to help</em>
        </h1>
        <p
          className="mt-5 text-base sm:text-lg leading-relaxed mx-auto"
          style={{ color: "#6B5A4E", maxWidth: "520px" }}
        >
          Real humans, real replies. Send a message below or email us directly —
          we usually answer within a business day.
        </p>
      </section>

      {/* Quick help cards */}
      <section className="max-w-5xl mx-auto px-5 sm:px-6 pb-10">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {helpCards.map(({ icon: Icon, title, body, href, cta }) => (
            <article
              key={title}
              className="rounded-2xl p-6 flex flex-col"
              style={{
                background: "#FFFFFF",
                border: "1px solid #DDD5C5",
                boxShadow: "0 4px 20px rgba(37,79,34,0.06)",
              }}
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                style={{ background: "#EAF0E8" }}
              >
                <Icon className="w-5 h-5" style={INK} />
              </div>
              <h2
                className="mb-2"
                style={{
                  ...SERIF,
                  ...INK,
                  fontSize: "1.15rem",
                  fontWeight: 700,
                  lineHeight: 1.2,
                }}
              >
                {title}
              </h2>
              <p
                className="text-sm leading-relaxed mb-5 flex-1"
                style={{ color: "#5C4A3C" }}
              >
                {body}
              </p>
              <Link
                href={href}
                className="text-sm font-semibold hover:underline"
                style={{ color: "#254F22" }}
              >
                {cta} →
              </Link>
            </article>
          ))}
        </div>
      </section>

      {/* Contact form */}
      <section className="max-w-2xl mx-auto px-5 sm:px-6 pb-24">
        <div className="flex items-center gap-6 mb-8">
          <div className="flex-1 h-px" style={{ background: "#E8E0D0" }} />
          <p
            style={{
              ...INK,
              ...SERIF,
              fontSize: "1.4rem",
              fontWeight: 700,
              letterSpacing: "0.22em",
              whiteSpace: "nowrap",
              lineHeight: 1,
            }}
          >
            WRITE TO US
          </p>
          <div className="flex-1 h-px" style={{ background: "#E8E0D0" }} />
        </div>

        <SupportForm />

        <p
          className="text-center text-xs mt-6 italic"
          style={{ color: "#8B6F4E", fontFamily: "var(--font-serif)" }}
        >
          We never share your email. Used only to reply to your message.
        </p>
      </section>

      <footer
        className="px-8 py-6 flex flex-col md:flex-row items-center md:justify-between gap-3 text-sm"
        style={{ borderTop: "1px solid #E8E0D0" }}
      >
        <Link href="/" className="flex items-center" aria-label="Hushare home">
          <img
            src="/logo/logo-dark-transparent.png"
            alt="Hushare"
            width={618}
            height={146}
            style={{ height: "24px", width: "auto" }}
          />
        </Link>
        <div className="flex items-center gap-5">
          <Link href="/" style={{ color: "#7C5C3E" }} className="hover:underline">
            Home
          </Link>
          <Link
            href="/pricing"
            style={{ color: "#7C5C3E" }}
            className="hover:underline"
          >
            Pricing
          </Link>
          <Link
            href="/privacy"
            style={{ color: "#7C5C3E" }}
            className="hover:underline"
          >
            Privacy
          </Link>
          <span style={{ color: "#B0A090" }}>
            © {new Date().getFullYear()} — your moments, always.
          </span>
        </div>
      </footer>
    </main>
  );
}

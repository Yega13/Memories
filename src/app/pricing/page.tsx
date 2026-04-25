import type { Metadata } from "next";
import Link from "next/link";
import { Leaf, Check, ArrowRight } from "lucide-react";

export const runtime = "nodejs";

const SITE_URL = "https://hushare.space";

const PAGE_TITLE = "Pricing";
const PAGE_DESCRIPTION =
  "Hushare pricing — a generous free tier, plus Pro and Studio plans for password-protected albums, custom URLs, HD video, and no inactivity expiry.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/pricing" },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/pricing`,
    title: `${PAGE_TITLE} · Hushare`,
    description: PAGE_DESCRIPTION,
    siteName: "Hushare",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
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

const tiers = [
  {
    name: "Free",
    tagline: "For one-off events and trips",
    price: "$0",
    cadence: "forever",
    cta: "Create your album",
    href: "/",
    highlight: false,
    features: [
      "Unlimited photos per album",
      "Anyone can view & add via the link",
      "Download full album as ZIP",
      "JPG, PNG, HEIC, WebP up to 25 MB",
      "Album auto-retires after 12 months of inactivity",
    ],
  },
  {
    name: "Pro",
    tagline: "For people who keep coming back",
    price: "$5",
    cadence: "per month",
    cta: "Notify me at launch",
    href: "mailto:hello@hushare.space?subject=Hushare%20Pro%20waitlist",
    highlight: true,
    features: [
      "Everything in Free, plus —",
      "Password-protect your albums",
      "Custom album URLs (e.g. hushare.space/anna-and-david)",
      "No 12-month inactivity expiry — albums live forever",
      "HD video uploads (MP4, MOV)",
      "Larger file sizes — up to 200 MB per upload",
    ],
  },
  {
    name: "Studio",
    tagline: "For photographers & event planners",
    price: "$15",
    cadence: "per month",
    cta: "Notify me at launch",
    href: "mailto:hello@hushare.space?subject=Hushare%20Studio%20waitlist",
    highlight: false,
    features: [
      "Everything in Pro, plus —",
      "Manage many albums from one dashboard",
      "Custom branding (logo, colours, cover image)",
      "Client-ready download links",
      "Priority support — replies within 24 hrs",
    ],
  },
];

const billingFaq = [
  {
    q: "What happens to my free albums if I cancel Pro or Studio?",
    a: "Nothing changes for guests. Your albums revert to Free behaviour — the password and custom URL are removed, the album becomes accessible by its original random link, and the 12-month inactivity rule applies again.",
  },
  {
    q: "Can I try Pro before I pay?",
    a: "Yes. We give you 14 days to use every Pro feature with no card on file. If you do not start a paid plan after the trial, the album quietly returns to the Free tier — nothing is deleted.",
  },
  {
    q: "How do you handle refunds?",
    a: "We refund any unused full month, no questions asked. Email hello@hushare.space and we'll process it within two business days.",
  },
  {
    q: "Do you offer annual pricing?",
    a: "Annual plans will land at launch with two months free (Pro $50/yr, Studio $150/yr). Want to lock that in early? Email us and we'll honour the annual price for the first year.",
  },
  {
    q: "Which currencies do you accept?",
    a: "USD at launch. EUR, GBP, and AMD prices are planned for late 2026 once we have a billing partner in place.",
  },
  {
    q: "Is there a discount for non-profits or weddings?",
    a: "Yes — registered non-profits get Studio for free. For one-off weddings, a single month of Pro usually covers it; we do not currently offer a wedding-specific discount.",
  },
];

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
          name: "Pricing",
          item: `${SITE_URL}/pricing`,
        },
      ],
    },
    {
      "@type": "WebPage",
      "@id": `${SITE_URL}/pricing#webpage`,
      url: `${SITE_URL}/pricing`,
      name: `${PAGE_TITLE} · Hushare`,
      description: PAGE_DESCRIPTION,
      inLanguage: "en",
      isPartOf: { "@id": `${SITE_URL}#website` },
    },
    {
      "@type": "Product",
      name: "Hushare",
      description: PAGE_DESCRIPTION,
      brand: { "@type": "Brand", name: "Hushare" },
      offers: tiers.map((t) => ({
        "@type": "Offer",
        name: `Hushare ${t.name}`,
        price: t.price.replace("$", ""),
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: `${SITE_URL}/pricing#${t.name.toLowerCase()}`,
      })),
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE_URL}/pricing#faq`,
      mainEntity: billingFaq.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },
  ],
};

const SERIF = { fontFamily: "var(--font-serif)" } as const;
const INK = { color: "#254F22" } as const;

export default function PricingPage() {
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
        <Link href="/" className="flex items-center gap-2">
          <Leaf className="w-5 h-5" style={INK} />
          <span style={{ ...SERIF, ...INK, fontSize: "1.25rem", fontWeight: 700 }}>
            Hushare
          </span>
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
      <section className="max-w-5xl mx-auto px-5 sm:px-8 pt-12 sm:pt-20 pb-10 text-center">
        <p
          className="text-xs sm:text-sm font-medium uppercase mb-4"
          style={{ color: "#8B6F4E", letterSpacing: "0.18em" }}
        >
          Pricing — Pro & Studio launching soon
        </p>
        <h1
          style={{
            ...SERIF,
            ...INK,
            fontSize: "clamp(2.2rem, 6vw, 3.6rem)",
            lineHeight: 1.1,
            fontWeight: 700,
          }}
        >
          Free for the moments<br />
          <em style={{ color: "#7C4A2D" }}>worth keeping forever</em>
        </h1>
        <p
          className="mt-5 text-base sm:text-lg leading-relaxed mx-auto"
          style={{ color: "#6B5A4E", maxWidth: "560px" }}
        >
          A generous free tier for one-off events. Two paid tiers for people who
          want passwords, custom URLs, HD video, and albums that never expire.
        </p>
      </section>

      {/* Tiers */}
      <section className="max-w-6xl mx-auto px-5 sm:px-6 pb-16">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-5 items-stretch">
          {tiers.map((t) => (
            <article
              key={t.name}
              id={t.name.toLowerCase()}
              className="relative rounded-3xl flex flex-col"
              style={{
                background: t.highlight ? "#254F22" : "#FFFFFF",
                color: t.highlight ? "#FDFAF5" : "#254F22",
                border: t.highlight
                  ? "1px solid #254F22"
                  : "1px solid #DDD5C5",
                boxShadow: t.highlight
                  ? "0 18px 48px rgba(37,79,34,0.30)"
                  : "0 4px 24px rgba(37,79,34,0.08)",
                padding: "2rem 1.75rem",
              }}
            >
              {t.highlight && (
                <span
                  className="absolute -top-3 left-1/2 text-[10px] font-semibold tracking-[0.18em] uppercase px-3 py-1 rounded-full"
                  style={{
                    transform: "translateX(-50%)",
                    background: "#F3E0BC",
                    color: "#7C4A2D",
                    border: "1px solid #C4A678",
                  }}
                >
                  Most loved
                </span>
              )}

              <h2
                style={{
                  ...SERIF,
                  fontSize: "1.6rem",
                  fontWeight: 700,
                  lineHeight: 1.1,
                }}
              >
                {t.name}
              </h2>
              <p
                className="text-sm mt-1 mb-5"
                style={{ color: t.highlight ? "rgba(253,250,245,0.75)" : "#8B6F4E" }}
              >
                {t.tagline}
              </p>

              <div className="flex items-baseline gap-2 mb-1">
                <span
                  style={{
                    ...SERIF,
                    fontSize: "2.6rem",
                    fontWeight: 700,
                    lineHeight: 1,
                  }}
                >
                  {t.price}
                </span>
                <span
                  className="text-sm"
                  style={{
                    color: t.highlight ? "rgba(253,250,245,0.75)" : "#8B6F4E",
                  }}
                >
                  {t.cadence}
                </span>
              </div>

              <div
                className="my-6 h-px w-full"
                style={{
                  background: t.highlight
                    ? "rgba(253,250,245,0.18)"
                    : "#E8E0D0",
                }}
              />

              <ul className="flex-1 space-y-3 mb-8">
                {t.features.map((f, i) => {
                  const isHeader = f.endsWith(" —");
                  return (
                    <li
                      key={i}
                      className="flex items-start gap-3 text-[0.95rem] leading-snug"
                      style={{
                        color: t.highlight
                          ? isHeader
                            ? "rgba(253,250,245,0.7)"
                            : "#FDFAF5"
                          : isHeader
                            ? "#8B6F4E"
                            : "#5C4A3C",
                        fontWeight: isHeader ? 600 : 400,
                      }}
                    >
                      {!isHeader && (
                        <Check
                          className="w-4 h-4 flex-none mt-0.5"
                          style={{
                            color: t.highlight ? "#F3E0BC" : "#254F22",
                          }}
                        />
                      )}
                      <span className={isHeader ? "" : ""}>{f}</span>
                    </li>
                  );
                })}
              </ul>

              <Link
                href={t.href}
                className="w-full inline-flex items-center justify-center gap-2 font-semibold rounded-xl py-3 transition hover:opacity-90"
                style={{
                  background: t.highlight ? "#FDFAF5" : "#254F22",
                  color: t.highlight ? "#254F22" : "#FDFAF5",
                }}
              >
                {t.cta} <ArrowRight className="w-4 h-4" />
              </Link>
            </article>
          ))}
        </div>

        <p
          className="text-center text-xs mt-6 italic"
          style={{ color: "#8B6F4E", fontFamily: "var(--font-serif)" }}
        >
          Prices in USD. Pro & Studio billed monthly; cancel anytime from your account.
        </p>
      </section>

      {/* Why pay section */}
      <section className="max-w-3xl mx-auto px-6 pb-20">
        <div
          className="rounded-2xl px-6 py-8 sm:px-10 sm:py-10"
          style={{
            background: "#FBF4E4",
            border: "1px solid rgba(196,166,120,0.35)",
          }}
        >
          <p
            className="text-xs uppercase mb-3"
            style={{ color: "#8B6F4E", letterSpacing: "0.18em", fontWeight: 600 }}
          >
            Why we charge
          </p>
          <h2
            className="mb-4"
            style={{
              ...SERIF,
              ...INK,
              fontSize: "1.6rem",
              fontWeight: 700,
              lineHeight: 1.2,
            }}
          >
            Free for the world. Paid for the keepers.
          </h2>
          <p
            className="text-[0.98rem] leading-relaxed"
            style={{ color: "#5C4A3C" }}
          >
            A wedding, a birthday, a one-week trip — these belong on the free tier
            forever. But a wedding photographer running ten albums a month, or a
            family that wants a single album to live for twenty years with a name
            you can actually remember — that costs us in storage and bandwidth, and
            it costs you a little to keep it. No ads. No selling your photos.
            Just a small subscription that pays for the servers and our coffee.
          </p>
        </div>
      </section>

      {/* Billing FAQ */}
      <section className="max-w-3xl mx-auto px-6 pb-24">
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
            BILLING FAQ
          </p>
          <div className="flex-1 h-px" style={{ background: "#E8E0D0" }} />
        </div>

        <div
          className="rounded-[8px] px-6 py-2 sm:px-10 sm:py-4"
          style={{
            background: "#FBF4E4",
            border: "1px solid rgba(196,166,120,0.35)",
            boxShadow: "0 10px 36px rgba(37,79,34,0.08)",
          }}
        >
          {billingFaq.map(({ q, a }, i, arr) => (
            <details
              key={i}
              className="group"
              style={{
                borderBottom:
                  i === arr.length - 1
                    ? "none"
                    : "1px dashed rgba(196,166,120,0.45)",
              }}
            >
              <summary
                className="list-none cursor-pointer flex items-start gap-4 py-5 select-none"
                style={{ outline: "none" }}
              >
                <span
                  aria-hidden
                  className="flex-none inline-flex items-center justify-center rounded-full transition-transform group-open:rotate-45"
                  style={{
                    width: "26px",
                    height: "26px",
                    background: "#254F22",
                    color: "#FDFAF5",
                    fontSize: "16px",
                    lineHeight: 1,
                    marginTop: "2px",
                  }}
                >
                  +
                </span>
                <span
                  style={{
                    ...SERIF,
                    ...INK,
                    fontSize: "1.05rem",
                    fontWeight: 600,
                    lineHeight: 1.35,
                  }}
                >
                  {q}
                </span>
              </summary>
              <p
                className="pb-5 pl-12 pr-2 text-[0.95rem] leading-relaxed"
                style={{ color: "#5C4A3C" }}
              >
                {a}
              </p>
            </details>
          ))}
        </div>

        <p
          className="text-center text-sm mt-8 italic"
          style={{ color: "#8B6F4E", fontFamily: "var(--font-serif)" }}
        >
          Other questions? Write to{" "}
          <a
            href="mailto:hello@hushare.space"
            style={{
              color: "#254F22",
              textDecoration: "underline",
              textDecorationStyle: "dotted",
            }}
          >
            hello@hushare.space
          </a>
        </p>
      </section>

      <footer
        className="px-8 py-6 flex flex-col md:flex-row items-center md:justify-between gap-3 text-sm"
        style={{ borderTop: "1px solid #E8E0D0" }}
      >
        <div className="flex items-center gap-2">
          <Leaf className="w-4 h-4" style={INK} />
          <span style={{ ...SERIF, ...INK, fontWeight: 600 }}>Hushare</span>
        </div>
        <div className="flex items-center gap-5">
          <Link href="/" style={{ color: "#7C5C3E" }} className="hover:underline">
            Home
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

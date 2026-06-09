import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import AccountNavLink from "@/components/AccountNavLink";

export const runtime = "nodejs";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://hushare.space";
const LAST_UPDATED = "2026-05-02";
const LAST_UPDATED_HUMAN = "May 2, 2026";

const PAGE_TITLE = "Terms of Service";
const PAGE_DESCRIPTION =
  "The rules for using Hushare, including content safety, moderation, account restrictions, and prohibited uploads.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: { canonical: "/terms" },
  openGraph: {
    type: "article",
    url: `${SITE_URL}/terms`,
    title: `${PAGE_TITLE} - Hushare`,
    description: PAGE_DESCRIPTION,
    siteName: "Hushare",
    locale: "en_US",
  },
  twitter: {
    card: "summary",
    title: `${PAGE_TITLE} - Hushare`,
    description: PAGE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "@id": `${SITE_URL}/terms#webpage`,
  url: `${SITE_URL}/terms`,
  name: `${PAGE_TITLE} - Hushare`,
  description: PAGE_DESCRIPTION,
  inLanguage: "en",
  dateModified: LAST_UPDATED,
  datePublished: LAST_UPDATED,
  isPartOf: { "@id": `${SITE_URL}#website` },
};

const SERIF = { fontFamily: "var(--font-serif)" } as const;
const INK = { color: "#254F22" } as const;
const BODY = { color: "#5C4A3C" } as const;

function Section({
  number,
  heading,
  children,
}: {
  number: number;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-2xl font-bold" style={{ ...SERIF, ...INK }}>
        <span style={{ color: "#7C4A2D", marginRight: "0.6rem" }}>{number}.</span>
        {heading}
      </h2>
      <div className="text-[0.98rem] leading-relaxed" style={BODY}>
        {children}
      </div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <main
      className="min-h-screen"
      style={{ background: "#FDFAF5", fontFamily: "var(--font-sans)" }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <nav
        className="hush-nav sticky top-0 z-50 flex items-center justify-between"
        style={{
          background: "rgba(253, 250, 245, 0.85)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(221, 213, 197, 0.5)",
        }}
      >
        <Link href="/" className="flex items-center" aria-label="Hushare home">
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
          <Link href="/about" className="text-sm font-medium hover:underline" style={{ color: "#254F22" }}>
            About
          </Link>
          <Link href="/collabs" className="text-sm font-medium hover:underline" style={{ color: "#254F22" }}>
            Collabs
          </Link>
          <Link href="/support" className="text-sm font-medium hover:underline" style={{ color: "#254F22" }}>
            Support
          </Link>
          <AccountNavLink />
        </div>
      </nav>

      <article className="hush-readable hush-fade-up py-16">
        <p
          className="mb-5 text-sm font-medium uppercase"
          style={{ color: "#8B6F4E", letterSpacing: "0.18em" }}
        >
          Legal - Hushare
        </p>
        <h1
          style={{
            ...SERIF,
            ...INK,
            fontSize: "clamp(2.35rem, 4.2vw, 4rem)",
            lineHeight: 1.1,
            fontWeight: 700,
          }}
        >
          Terms of Service
        </h1>
        <p className="mt-4 text-sm" style={{ color: "#8B6F4E" }}>
          Last updated: <time dateTime={LAST_UPDATED}>{LAST_UPDATED_HUMAN}</time>
        </p>

        <p className="mt-8 text-lg leading-relaxed" style={BODY}>
          Hushare is for collecting and keeping real event memories. By creating an album,
          uploading media, or sharing a Hushare link, you agree to these rules.
        </p>

        <Section number={1} heading="Allowed use">
          <p>
            You may use Hushare to create shared albums, invite guests, upload photos
            and videos, customize albums, and download albums you own or were invited to.
          </p>
        </Section>

        <Section number={2} heading="Prohibited content">
          <p>Do not upload, share, request, or promote content that includes:</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Child sexual abuse material or sexual content involving minors.</li>
            <li>Non-consensual intimate imagery, sexual exploitation, or doxxing.</li>
            <li>Graphic violence, gore, murder, torture, or instructions for serious harm.</li>
            <li>Illegal activity, scams, malware, spam, or attempts to abuse the service.</li>
            <li>Harassment, threats, hate content, or targeted abuse.</li>
            <li>Content you do not have the right to upload, including copyright violations.</li>
          </ul>
        </Section>

        <Section number={3} heading="Moderation and enforcement">
          <p>
            Hushare may review reported, suspicious, or high-risk albums. We may remove
            uploads, disable albums, restrict accounts, block access, preserve evidence,
            or report serious abuse to appropriate services or authorities when required.
          </p>
          <p className="mt-3">
            We do not promise that every upload is reviewed before it appears. Album owners
            should only share links with people they trust and should report abuse quickly.
          </p>
        </Section>

        <Section number={4} heading="Album ownership">
          <p>
            Anonymous albums are controlled by the owner link. Keep it private. Anyone with
            that owner link may manage the album, so Hushare cannot always tell who originally
            created it without extra verification.
          </p>
        </Section>

        <Section number={5} heading="Reports and contact">
          <p>
            To report illegal, abusive, or unwanted content, email{" "}
            <a href="mailto:husharesupport@gmail.com" style={{ ...INK, fontWeight: 700 }}>
              husharesupport@gmail.com
            </a>{" "}
            with the album link and a short explanation. If someone is in immediate danger,
            contact local emergency services first.
          </p>
        </Section>

        <Section number={6} heading="DMCA / Copyright takedowns">
          <p>
            Hushare respects intellectual property rights and complies with the Digital
            Millennium Copyright Act (&ldquo;DMCA&rdquo;). If you believe content uploaded to
            Hushare infringes your copyright, you may submit a written takedown notice to our
            designated agent:
          </p>
          <p className="mt-3 font-semibold" style={INK}>
            DMCA Designated Agent — Hushare
          </p>
          <p className="mt-1 text-sm" style={{ color: "#8B6F4E" }}>
            Registration Number: DMCA-1072882 (U.S. Copyright Office)
          </p>
          <p className="mt-1">
            Email:{" "}
            <a href="mailto:husharesupport@gmail.com" style={{ ...INK, fontWeight: 700 }}>
              husharesupport@gmail.com
            </a>
          </p>
          <p className="mt-3">Your notice must include:</p>
          <ol className="mt-2 list-decimal space-y-2 pl-5">
            <li>Identification of the copyrighted work you claim has been infringed.</li>
            <li>The URL or other specific location of the allegedly infringing content on Hushare.</li>
            <li>Your contact information (name, address, telephone number, email).</li>
            <li>
              A statement that you have a good-faith belief that the use is not authorised by the
              copyright owner, its agent, or the law.
            </li>
            <li>
              A statement, under penalty of perjury, that the information in your notice is
              accurate and that you are the copyright owner or authorised to act on their behalf.
            </li>
            <li>Your physical or electronic signature.</li>
          </ol>
          <p className="mt-3">
            Upon receiving a valid notice we will remove or disable access to the content promptly
            and notify the uploader. Counter-notices may be submitted to the same address following
            the standard DMCA counter-notice procedure.
          </p>
        </Section>

        <Section number={7} heading="Changes">
          <p>
            We may update these terms as Hushare grows. The latest version will always live
            on this page.
          </p>
        </Section>
      </article>
    </main>
  );
}

import type { Metadata, Viewport } from "next";
import { Geist, Playfair_Display } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-serif",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const runtime = "nodejs";

const SITE_URL = "https://hushare.org";
const SITE_NAME = "Hushare";
const TAGLINE = "Shared photo albums from one link";
const DESCRIPTION =
  "Create a shared photo album in seconds. Guests add photos from one link — no app, no sign-up. Perfect for weddings, trips, reunions, and every moment worth keeping.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — ${TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "photography",
  keywords: [
    "shared photo album",
    "collaborative photo album",
    "wedding photo sharing",
    "wedding guest photo app",
    "event photo sharing",
    "guest photo collection",
    "QR code photo sharing",
    "share photos without an app",
    "no sign up photo album",
    "party photo sharing",
    "trip photo album",
    "family photo sharing",
    "free photo sharing",
    "group photo album",
    "Hushare",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${TAGLINE}`,
    description: DESCRIPTION,
    locale: "en_US",
    images: [
      {
        url: "/wedding.jpg",
        width: 700,
        height: 1052,
        alt:
          "Hushare — shared photo album for weddings, trips, and the moments worth keeping",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — ${TAGLINE}`,
    description: DESCRIPTION,
    images: ["/wedding.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/favicon.ico",
  },
  referrer: "origin-when-cross-origin",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FDFAF5" },
    { media: "(prefers-color-scheme: dark)", color: "#254F22" },
  ],
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/favicon.ico`,
      foundingLocation: {
        "@type": "Place",
        name: "Yerevan, Armenia",
      },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}#website`,
      url: SITE_URL,
      name: SITE_NAME,
      description: DESCRIPTION,
      publisher: { "@id": `${SITE_URL}#organization` },
      inLanguage: "en",
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}#app`,
      name: SITE_NAME,
      url: SITE_URL,
      description: DESCRIPTION,
      applicationCategory: "PhotoApplication",
      operatingSystem: "Any (Web browser)",
      browserRequirements:
        "Requires JavaScript. Works in any modern browser.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      featureList: [
        "No account or sign-up required",
        "Share albums via link or QR code",
        "Unlimited contributors per album",
        "Private link-based ownership",
        "Download every photo as a ZIP",
      ],
      publisher: { "@id": `${SITE_URL}#organization` },
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE_URL}#faq`,
      mainEntity: [
        {
          "@type": "Question",
          name: "Do guests need an account to add photos to a shared album?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "No. Anyone with your Hushare album link can view and add photos — no sign-up, no app download.",
          },
        },
        {
          "@type": "Question",
          name: "How long does Hushare keep my photos?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Free albums are kept as long as they remain active. If an album sits untouched for 12 months, it is automatically retired. Active albums live on indefinitely.",
          },
        },
        {
          "@type": "Question",
          name: "Is Hushare free?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. Hushare is free during beta, with no credit card required.",
          },
        },
        {
          "@type": "Question",
          name: "Can I collect photos from wedding guests with a QR code?",
          acceptedAnswer: {
            "@type": "Answer",
            text: "Yes. Each album has a unique link you can turn into a QR code and place on tables, invitations, or programs.",
          },
        },
      ],
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${playfair.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {children}
      </body>
    </html>
  );
}

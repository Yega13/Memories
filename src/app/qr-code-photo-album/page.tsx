import type { Metadata } from "next";
import SeoLandingPage from "@/components/SeoLandingPage";

const SITE_URL = "https://hushare.space";
const title = "QR Code Photo Album for Events";
const description =
  "Make a QR code photo album guests can scan to upload photos and videos instantly, without accounts, app downloads, or complicated setup.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/qr-code-photo-album" },
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/qr-code-photo-album`,
    images: [{ url: "/card2.jpg", width: 1200, height: 900, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/card2.jpg"],
  },
};

export default function QrCodePhotoAlbumPage() {
  const faq = [
    {
      q: "Does Hushare generate a shareable album link?",
      a: "Yes. Every album gets a private link that can be copied or turned into a QR code for guests.",
    },
    {
      q: "Where should I place the QR code?",
      a: "Use it on table cards, welcome signs, invitations, programs, printed menus, or a projected screen at the event.",
    },
    {
      q: "Will guests need to log in after scanning?",
      a: "No. Scanning the QR code opens the album directly, and guests can upload from the browser.",
    },
  ];

  return (
    <SeoLandingPage
      eyebrow="QR code photo album"
      title={title}
      intro={description}
      image="/card2.jpg"
      imageAlt="A QR-ready shared photo album for guests"
      useCases={[
        "Print a QR code once and let guests add photos all night.",
        "Avoid app downloads, shared drives, and messy file requests after the event.",
        "Keep the album link private, but easy for invited guests to open.",
      ]}
      details={[
        {
          title: "Scan and upload",
          body: "A QR photo album works because the action is immediate. Guests scan the code and land on the upload page.",
        },
        {
          title: "One code, one album",
          body: "Use the same album link everywhere, so every guest contribution ends up in the same collection.",
        },
        {
          title: "Owner link stays separate",
          body: "The public QR link is for guests. The owner link is for management, settings, and downloads.",
        },
      ]}
      faq={faq}
      jsonLd={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faq.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      }}
    />
  );
}

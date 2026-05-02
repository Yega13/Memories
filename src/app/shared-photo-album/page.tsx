import type { Metadata } from "next";
import SeoLandingPage from "@/components/SeoLandingPage";

const SITE_URL = "https://hushare.space";
const title = "Shared Photo Album From One Link";
const description =
  "Start a shared photo album in seconds. Friends, family, and guests can add photos and videos from one private link with no sign-up.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/shared-photo-album" },
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/shared-photo-album`,
    images: [{ url: "/card3.jpg", width: 1200, height: 900, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/card3.jpg"],
  },
};

export default function SharedPhotoAlbumPage() {
  const faq = [
    {
      q: "What is a shared photo album?",
      a: "It is one album link where multiple people can view and add photos, instead of sending files one by one.",
    },
    {
      q: "Can I create one without an account?",
      a: "Yes. Hushare lets anyone create an album immediately and manage it later with the private owner link.",
    },
    {
      q: "Are shared albums public?",
      a: "No. Albums are unlisted and are meant for people who have the link.",
    },
  ];

  return (
    <SeoLandingPage
      eyebrow="Shared photo album"
      title={title}
      intro={description}
      image="/card3.jpg"
      imageAlt="A shared Hushare photo album from one private link"
      useCases={[
        "Use one private link for trips, families, birthdays, teams, and group memories.",
        "Let contributors upload without creating an account or installing an app.",
        "Download the full album later from the owner view.",
      ]}
      details={[
        {
          title: "Built for quick sharing",
          body: "You create the album, copy the link, and send it. The product stays out of the way.",
        },
        {
          title: "Photos and videos together",
          body: "Guests can add common image formats and videos, with larger upload limits on paid albums.",
        },
        {
          title: "Flexible for paid albums",
          body: "Pro and Studio owners can add custom URLs, password protection, bigger uploads, and no inactivity expiry.",
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

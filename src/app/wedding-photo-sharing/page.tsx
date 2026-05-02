import type { Metadata } from "next";
import SeoLandingPage from "@/components/SeoLandingPage";

const SITE_URL = "https://hushare.space";
const title = "Wedding Photo Sharing Without an App";
const description =
  "Create one private wedding photo album link, turn it into a QR code, and let every guest add photos without sign-up or app downloads.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/wedding-photo-sharing" },
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/wedding-photo-sharing`,
    images: [{ url: "/wedding.jpg", width: 700, height: 1052, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/wedding.jpg"],
  },
};

export default function WeddingPhotoSharingPage() {
  const faq = [
    {
      q: "Do wedding guests need an account?",
      a: "No. Guests open the wedding album link or scan the QR code and can add photos from their browser.",
    },
    {
      q: "Can we print the link as a QR code?",
      a: "Yes. Every album has a share link that works well on welcome signs, table cards, invitations, and group chats.",
    },
    {
      q: "Can the couple download everything later?",
      a: "Yes. The album owner can return with the owner link and download the full album as a ZIP.",
    },
  ];

  return (
    <SeoLandingPage
      eyebrow="Wedding photo sharing"
      title={title}
      intro={description}
      image="/wedding.jpg"
      imageAlt="Wedding guests collecting shared photos in one Hushare album"
      useCases={[
        "Collect guest photos from the ceremony, reception, after-party, and morning-after brunch in one place.",
        "Use the same album link in printed QR cards and group chats so guests never need to install anything.",
        "Keep the owner link private so the couple can manage, download, and customize the album later.",
      ]}
      details={[
        {
          title: "One album for every guest",
          body: "Hushare is built for people who will not download another app at a wedding. A browser link is enough.",
        },
        {
          title: "QR-friendly by design",
          body: "Put the album link anywhere guests will see it. They scan, open, and upload without a password unless you add one.",
        },
        {
          title: "Private, unlisted albums",
          body: "Wedding albums are not added to public directories. Only people with the link can find them.",
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

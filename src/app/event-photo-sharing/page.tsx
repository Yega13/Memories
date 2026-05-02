import type { Metadata } from "next";
import SeoLandingPage from "@/components/SeoLandingPage";

const SITE_URL = "https://hushare.space";
const title = "Event Photo Sharing for Guests and Groups";
const description =
  "Create a shared event photo album where guests can upload photos and videos from one private link, with no account or app required.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/event-photo-sharing" },
  openGraph: {
    title,
    description,
    url: `${SITE_URL}/event-photo-sharing`,
    images: [{ url: "/children.avif", width: 1200, height: 900, alt: title }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/children.avif"],
  },
};

export default function EventPhotoSharingPage() {
  const faq = [
    {
      q: "What kinds of events can use Hushare?",
      a: "Weddings, birthdays, reunions, school events, retreats, trips, parties, and community gatherings all work well.",
    },
    {
      q: "Can guests upload videos too?",
      a: "Yes. Albums support common photo formats plus MP4, MOV, and WebM videos within the plan limits.",
    },
    {
      q: "Can an event organizer manage the album?",
      a: "Yes. The organizer keeps the owner link, which unlocks album settings, downloads, deletion, and paid features.",
    },
  ];

  return (
    <SeoLandingPage
      eyebrow="Event photo sharing"
      title={title}
      intro={description}
      image="/children.avif"
      imageAlt="A shared event photo album for family and community moments"
      useCases={[
        "Collect photos from everyone who attended instead of chasing files after the event.",
        "Share one link before, during, or after the event, then let the album fill itself.",
        "Use Studio Collections when one event needs multiple albums grouped under one public page.",
      ]}
      details={[
        {
          title: "No app barrier",
          body: "Guests can contribute from the browser they already have, which is the difference between a full album and an empty one.",
        },
        {
          title: "Links and QR codes",
          body: "Send the link in chat, print it, or show it on a screen. The same album link works everywhere.",
        },
        {
          title: "Owner controls",
          body: "The owner view keeps album management separate from the guest experience, so contributors only see what they need.",
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

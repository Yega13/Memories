import type { MetadataRoute } from "next";

export const runtime = "nodejs";

const SITE_URL = "https://hushare.space";

const PUBLIC_AGENTS = [
  "Googlebot",
  "Googlebot-Image",
  "Bingbot",
  "Slurp",
  "DuckDuckBot",
  "YandexBot",
  "YandexImages",
  "Baiduspider",
  "Applebot",
];

export default function robots(): MetadataRoute.Robots {
  const allowAll = {
    allow: ["/", "/pricing", "/support", "/privacy"],
    disallow: ["/api/"],
  };

  return {
    rules: [
      { userAgent: "*", ...allowAll },
      ...PUBLIC_AGENTS.map((userAgent) => ({ userAgent, ...allowAll })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}

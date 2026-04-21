import type { MetadataRoute } from "next";

export const runtime = "nodejs";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://hushare.org/",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}

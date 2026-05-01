import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "live.staticflickr.com" },
      { protocol: "https", hostname: "i.pinimg.com" },
      { protocol: "https", hostname: "api.qrserver.com" },
      { protocol: "https", hostname: "videos.hushare.space" },
      {
        protocol: "https",
        hostname: "zleajzevvhugkwlqlolt.supabase.co",
      },
    ],
  },
};

export default nextConfig;

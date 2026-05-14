import type { NextConfig } from "next";

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://pagead2.googlesyndication.com https://www.googletagservices.com https://partner.googleadservices.com https://tpc.googlesyndication.com https://adservice.google.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://zleajzevvhugkwlqlolt.supabase.co wss://zleajzevvhugkwlqlolt.supabase.co https://challenges.cloudflare.com",
  "media-src 'self' blob: https://videos.hushare.space https://zleajzevvhugkwlqlolt.supabase.co",
  "frame-src 'self' https://challenges.cloudflare.com https://googleads.g.doubleclick.net https://tpc.googlesyndication.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
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

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const VERIFIED_FROM = "Hushare Support <support@hushare.space>";
const VERIFIED_TO = "support@hushare.space";
const FALLBACK_FROM = "Hushare Support <onboarding@resend.dev>";
const FALLBACK_TO = "husharesupport@gmail.com";

const ALLOWED_ORIGIN_HOSTS = new Set([
  "hushare.space",
  "www.hushare.space",
]);
// Cloudflare preview deployments live on *.workers.dev / *.pages.dev.
const ALLOWED_ORIGIN_SUFFIXES = [".workers.dev", ".pages.dev"];

function isAllowedOrigin(origin: string, host: string | null): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  // Same-origin (origin host matches the request's Host header) always allowed.
  if (host && url.host === host) return true;
  if (ALLOWED_ORIGIN_HOSTS.has(url.host)) return true;
  if (ALLOWED_ORIGIN_SUFFIXES.some((s) => url.host.endsWith(s))) return true;
  // localhost for `next dev` / preview.
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return true;
  return false;
}

type Body = {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
  turnstileToken?: string;
};

// RFC 5322 "looks-like-an-email"; rejects whitespace and requires a TLD ≥ 2 chars.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Strip control chars and collapse whitespace — defends against header-injection
// in single-line fields (subject, name) and keeps Resend's API happy.
function sanitizeLine(str: string): string {
  return str.replace(/[\x00-\x1F\x7F]/g, " ").replace(/\s+/g, " ").trim();
}

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

export async function POST(req: Request) {
  // Block cross-site abuse: only our own pages (or same-origin previews) can POST here.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin && !isAllowedOrigin(origin, host)) {
    return json(403, { error: "Forbidden" });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid request body" });
  }

  const name = sanitizeLine((body.name ?? "")).slice(0, 80);
  const email = (body.email ?? "").trim().slice(0, 120);
  const subject = sanitizeLine((body.subject ?? "")).slice(0, 120);
  const message = (body.message ?? "").trim().slice(0, 4000);

  if (!email || !EMAIL_RE.test(email)) {
    return json(400, { error: "Please enter a valid email" });
  }
  if (!message) {
    return json(400, { error: "Please write a message" });
  }

  // Turnstile verification: if a secret is configured, the token must verify.
  // If no secret is set, skip — keeps local/preview deployments working.
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY;
  if (turnstileSecret) {
    const token = (body.turnstileToken ?? "").trim();
    if (!token) {
      return json(400, { error: "Please complete the verification" });
    }
    try {
      const verify = await fetch(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            secret: turnstileSecret,
            response: token,
            remoteip: req.headers.get("cf-connecting-ip") ?? "",
          }),
        },
      );
      const result = (await verify.json()) as { success: boolean; "error-codes"?: string[] };
      if (!result.success) {
        console.warn("[support] Turnstile failed:", result["error-codes"]);
        return json(403, { error: "Verification failed — please try again" });
      }
    } catch (err) {
      console.error("[support] Turnstile verify request failed:", err);
      return json(502, { error: "Verification service unavailable" });
    }
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[support] RESEND_API_KEY not set — message dropped");
    return json(503, { error: "Our message system isn't configured yet" });
  }

  const domainVerified = process.env.RESEND_DOMAIN_VERIFIED === "true";
  const fromAddress = domainVerified ? VERIFIED_FROM : FALLBACK_FROM;
  const toAddress = domainVerified ? VERIFIED_TO : FALLBACK_TO;

  const safeName = name || "(no name)";
  const subjectLine = subject || "Hushare support — new message";

  const text = [
    "New support message",
    "",
    `From: ${safeName} <${email}>`,
    `Subject: ${subjectLine}`,
    "",
    "----",
    message,
    "----",
    "",
    `Reply directly to this email to respond to ${safeName}.`,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, system-ui, sans-serif; color: #254F22; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="margin: 0 0 16px; font-size: 18px;">New support message</h2>
      <p style="margin: 0 0 8px; color: #5C4A3C;"><strong>From:</strong> ${escapeHtml(safeName)} &lt;${escapeHtml(email)}&gt;</p>
      <p style="margin: 0 0 8px; color: #5C4A3C;"><strong>Subject:</strong> ${escapeHtml(subjectLine)}</p>
      <hr style="border: none; border-top: 1px solid #E8E0D0; margin: 16px 0;" />
      <pre style="white-space: pre-wrap; font-family: inherit; font-size: 14px; line-height: 1.5; color: #5C4A3C; margin: 0;">${escapeHtml(message)}</pre>
      <hr style="border: none; border-top: 1px solid #E8E0D0; margin: 24px 0 12px;" />
      <p style="margin: 0; color: #B0A090; font-size: 12px;">Reply directly to this email to respond to ${escapeHtml(safeName)}.</p>
    </div>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [toAddress],
        reply_to: email,
        subject: `[Support] ${subjectLine}`,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("[support] Resend error:", res.status, errBody);
      return json(502, { error: "Our mail service rejected the message" });
    }

    return json(200, { ok: true });
  } catch (err) {
    console.error("[support] fetch failed:", err);
    return json(502, { error: "Network error reaching our mail service" });
  }
}

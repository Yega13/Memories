import { NextResponse } from "next/server";

export const runtime = "nodejs";

const VERIFIED_FROM = "Hushare Support <support@hushare.space>";
const VERIFIED_TO = "support@hushare.space";
const FALLBACK_FROM = "Hushare Support <onboarding@resend.dev>";
const FALLBACK_TO = "husharesupport@gmail.com";

const ALLOWED_ORIGINS = new Set([
  "https://hushare.space",
  "https://www.hushare.space",
]);

type Body = {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
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
  // Block cross-site abuse: only our own pages can POST here.
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
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

import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Once hushare.space is verified in Resend AND RESEND_DOMAIN_VERIFIED=true is set,
// the From address becomes hello@hushare.space and we send to hello@hushare.space
// (which Cloudflare Email Routing forwards to husharesupport@gmail.com).
//
// Until then we send from Resend's shared sender to the gmail directly — that's the
// only TO address Resend permits in unverified test mode.
const VERIFIED_FROM = "Hushare Support <hello@hushare.space>";
const VERIFIED_TO = "hello@hushare.space";
const FALLBACK_FROM = "Hushare Support <onboarding@resend.dev>";
const FALLBACK_TO = "husharesupport@gmail.com";

type Body = {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const name = (body.name ?? "").trim().slice(0, 80);
  const email = (body.email ?? "").trim().slice(0, 120);
  const subject = (body.subject ?? "").trim().slice(0, 120);
  const message = (body.message ?? "").trim().slice(0, 4000);

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Please enter a valid email" }, { status: 400 });
  }
  if (!message || message.length < 5) {
    return NextResponse.json({ error: "Please write a message" }, { status: 400 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[support] RESEND_API_KEY not set — message dropped:", {
      from: email,
      subject,
      length: message.length,
    });
    return NextResponse.json(
      { error: "Our message system isn't configured yet" },
      { status: 503 },
    );
  }

  const domainVerified = process.env.RESEND_DOMAIN_VERIFIED === "true";
  const fromAddress = domainVerified ? VERIFIED_FROM : FALLBACK_FROM;
  const toAddress = domainVerified ? VERIFIED_TO : FALLBACK_TO;

  const safeName = name || "(no name)";
  const subjectLine = subject || "Hushare support — new message";
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
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(
        "[support] Resend error:",
        res.status,
        errBody,
        "domainVerified=",
        domainVerified,
        "from=",
        fromAddress,
        "to=",
        toAddress,
      );
      return NextResponse.json(
        { error: "Our mail service rejected the message" },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[support] fetch failed:", err);
    return NextResponse.json(
      { error: "Network error reaching our mail service" },
      { status: 502 },
    );
  }
}

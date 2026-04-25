import { NextResponse } from "next/server";

export const runtime = "nodejs";

const SUPPORT_DESTINATION = "hello@hushare.space";
const FROM_ADDRESS = "Hushare Support <hello@hushare.space>";
const RESEND_FALLBACK_FROM = "Hushare Support <onboarding@resend.dev>";

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
      {
        error:
          "Our message system is not yet configured. Please email us directly at hello@hushare.space",
      },
      { status: 503 },
    );
  }

  // Resend allows a verified domain in the From; until hushare.space is
  // verified there, fall back to onboarding@resend.dev which works in test mode.
  const fromAddress = process.env.RESEND_DOMAIN_VERIFIED === "true"
    ? FROM_ADDRESS
    : RESEND_FALLBACK_FROM;

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
        to: [SUPPORT_DESTINATION],
        reply_to: email,
        subject: `[Support] ${subjectLine}`,
        html,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error("[support] Resend error:", res.status, errBody);
      return NextResponse.json(
        {
          error:
            "We couldn't send your message right now. Please email us directly at hello@hushare.space",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[support] fetch failed:", err);
    return NextResponse.json(
      {
        error:
          "Network error reaching our mail service. Please email us directly at hello@hushare.space",
      },
      { status: 502 },
    );
  }
}

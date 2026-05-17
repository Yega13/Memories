const VERIFIED_FROM = 'Hushare <noreply@hushare.space>'
const FALLBACK_FROM = 'Hushare <onboarding@resend.dev>'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushare.space'
const MAILING_ADDRESS = process.env.MAILING_ADDRESS ?? 'Hushare, Yerevan, Armenia'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[email] RESEND_API_KEY not set — email dropped')
    return
  }
  const domainVerified = process.env.RESEND_DOMAIN_VERIFIED === 'true'
  const from = domainVerified ? VERIFIED_FROM : FALLBACK_FROM

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html, text }),
    })
    if (!res.ok) {
      console.error('[email] Resend error:', res.status, await res.text())
    }
  } catch (err) {
    console.error('[email] fetch failed:', err instanceof Error ? err.message : String(err))
  }
}

export async function sendPhotoNotificationEmail(
  ownerEmail: string,
  albumTitle: string,
  albumUrl: string,
  photoCount: number,
) {
  const noun = photoCount === 1 ? 'photo' : 'photos'
  const subject = `${photoCount} new ${noun} added to "${albumTitle}"`

  const html = `
<div style="font-family:-apple-system,system-ui,sans-serif;color:#254F22;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 16px;font-size:18px;">${escapeHtml(String(photoCount))} new ${noun} added</h2>
  <p style="margin:0 0 16px;color:#5C4A3C;">
    Someone just added <strong>${escapeHtml(String(photoCount))} ${noun}</strong> to your album
    <strong>${escapeHtml(albumTitle)}</strong>.
  </p>
  <a href="${escapeHtml(albumUrl)}"
     style="display:inline-block;background:#254F22;color:#FDFAF5;text-decoration:none;border-radius:10px;padding:10px 20px;font-size:14px;font-weight:600;">
    View album
  </a>
  <hr style="border:none;border-top:1px solid #E8E0D0;margin:24px 0 12px;" />
  <p style="margin:0;color:#B0A090;font-size:12px;">
    You received this because you own an album on
    <a href="${escapeHtml(SITE_URL)}" style="color:#B0A090;">Hushare</a>.
    To stop receiving these emails, reply with "unsubscribe" or email
    <a href="mailto:husharesupport@gmail.com" style="color:#B0A090;">husharesupport@gmail.com</a>.
  </p>
  <p style="margin:6px 0 0;color:#B0A090;font-size:11px;">${escapeHtml(MAILING_ADDRESS)}</p>
</div>`

  const text = [
    subject,
    '',
    `Someone added ${photoCount} ${noun} to your album. View it here:`,
    albumUrl,
    '',
    'You received this because you own an album on Hushare.',
    'To unsubscribe, reply to this email or contact husharesupport@gmail.com.',
    MAILING_ADDRESS,
  ].join('\n')

  await sendEmail(ownerEmail, subject, html, text)
}

export async function sendExpiryWarningEmail(
  ownerEmail: string,
  albumTitle: string,
  albumUrl: string,
  daysLeft: number,
) {
  const subject = `Your Hushare album "${albumTitle}" will be deleted in ${daysLeft} days`

  const html = `
<div style="font-family:-apple-system,system-ui,sans-serif;color:#254F22;max-width:560px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 16px;font-size:18px;">Your album is about to expire</h2>
  <p style="margin:0 0 16px;color:#5C4A3C;">
    Your Hushare album <strong>${escapeHtml(albumTitle)}</strong> hasn't had any activity
    in a while and will be <strong>automatically deleted in ${daysLeft} day${daysLeft === 1 ? '' : 's'}</strong>.
  </p>
  <p style="margin:0 0 20px;color:#5C4A3C;">
    To keep it, just visit the album — any upload or view resets the timer.
  </p>
  <a href="${escapeHtml(albumUrl)}"
     style="display:inline-block;background:#254F22;color:#FDFAF5;text-decoration:none;border-radius:10px;padding:10px 20px;font-size:14px;font-weight:600;">
    View album
  </a>
  <hr style="border:none;border-top:1px solid #E8E0D0;margin:24px 0 12px;" />
  <p style="margin:0;color:#B0A090;font-size:12px;">
    Free albums on <a href="${escapeHtml(SITE_URL)}" style="color:#B0A090;">Hushare</a>
    are kept for 12 months after last activity.
    <a href="${escapeHtml(SITE_URL)}/pricing" style="color:#B0A090;">Upgrade to a paid plan</a>
    to keep your albums forever.
    To stop receiving these emails, reply with "unsubscribe" or email
    <a href="mailto:husharesupport@gmail.com" style="color:#B0A090;">husharesupport@gmail.com</a>.
  </p>
  <p style="margin:6px 0 0;color:#B0A090;font-size:11px;">${escapeHtml(MAILING_ADDRESS)}</p>
</div>`

  const text = [
    subject,
    '',
    `Your album hasn't had any activity in a while and will be automatically deleted in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
    '',
    'To keep it, just visit the album — any activity resets the timer:',
    albumUrl,
    '',
    'Free albums on Hushare are kept for 12 months after last activity.',
    `Upgrade to a paid plan to keep your albums forever: ${SITE_URL}/pricing`,
    '',
    'To unsubscribe, reply to this email or contact husharesupport@gmail.com.',
    MAILING_ADDRESS,
  ].join('\n')

  await sendEmail(ownerEmail, subject, html, text)
}

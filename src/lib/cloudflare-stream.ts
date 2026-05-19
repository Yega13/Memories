const STREAM_API_BASE = 'https://api.cloudflare.com/client/v4'

export type StreamVideoFields = {
  stream_uid: string
  stream_iframe_url: string
  stream_thumbnail_url: string
}

export function streamConfig() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_STREAM_TOKEN
  if (!accountId || !token) return null
  return { accountId, token }
}

export function streamUrls(uid: string): StreamVideoFields {
  return {
    stream_uid: uid,
    stream_iframe_url: `https://iframe.videodelivery.net/${uid}`,
    stream_thumbnail_url: `https://videodelivery.net/${uid}/thumbnails/thumbnail.jpg?time=1s&height=720&fit=clip`,
  }
}

export async function deleteStreamVideo(uid: string): Promise<void> {
  const config = streamConfig()
  if (!config) return

  const res = await fetch(`${STREAM_API_BASE}/accounts/${config.accountId}/stream/${encodeURIComponent(uid)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${config.token}` },
  })

  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '')
    throw new Error(`Cloudflare Stream delete failed: ${res.status} ${body}`)
  }
}

import type { CollectionSummary } from '@/components/owner-toolbar/types'
import type { MediaDisplayFilter, MediaHoverEffect, MobileGridColumns } from '@/lib/media-display'

async function jsonBody<T>(res: Response): Promise<T> {
  return (await res.json().catch(() => ({}))) as T
}

export async function fetchCollections(slug: string, ownerToken: string): Promise<CollectionSummary[]> {
  const params = new URLSearchParams({ slug, owner_token: ownerToken })
  const res = await fetch(`/api/collections?${params.toString()}`)
  const body = await jsonBody<{ collections?: CollectionSummary[] }>(res)
  return res.ok ? body.collections ?? [] : []
}

export async function saveCustomUrlRequest(
  slug: string,
  ownerToken: string,
  customSlug: string | null,
): Promise<{ ok: true; custom_slug: string | null } | { ok: false; error: string }> {
  const res = await fetch('/api/album/custom-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, owner_token: ownerToken, custom_slug: customSlug }),
  })
  const body = await jsonBody<{ error?: string; custom_slug?: string | null }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  return { ok: true, custom_slug: body.custom_slug ?? null }
}

export async function savePasswordRequest(
  slug: string,
  ownerToken: string,
  password: string | null,
): Promise<{ ok: true; password_protected: boolean } | { ok: false; error: string }> {
  const res = await fetch('/api/album/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, owner_token: ownerToken, password }),
  })
  const body = await jsonBody<{ error?: string; password_protected?: boolean }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  return { ok: true, password_protected: !!body.password_protected }
}

export async function saveBackgroundRequest(
  slug: string,
  ownerToken: string,
  backgroundTheme: string | null,
): Promise<{ ok: true; background_theme: string | null } | { ok: false; error: string }> {
  const res = await fetch('/api/album/background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, owner_token: ownerToken, background_theme: backgroundTheme }),
  })
  const body = await jsonBody<{ error?: string; background_theme?: string | null }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  return { ok: true, background_theme: body.background_theme ?? null }
}

export async function saveMediaSettingsRequest(
  slug: string,
  ownerToken: string,
  mediaRadius: number,
  videoAutoplay: boolean,
  mediaFilter: MediaDisplayFilter,
  mediaHover: MediaHoverEffect,
  mobileGridColumns: MobileGridColumns,
  resetRadiusOverrides: boolean,
  resetFilterOverrides: boolean,
): Promise<{ ok: true; media_radius: number; video_autoplay: boolean; media_filter: MediaDisplayFilter; media_hover: MediaHoverEffect; mobile_grid_columns: MobileGridColumns } | { ok: false; error: string }> {
  const res = await fetch('/api/album/media-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug,
      owner_token: ownerToken,
      media_radius: mediaRadius,
      video_autoplay: videoAutoplay,
      media_filter: mediaFilter,
      media_hover: mediaHover,
      mobile_grid_columns: mobileGridColumns,
      reset_radius_overrides: resetRadiusOverrides,
      reset_filter_overrides: resetFilterOverrides,
    }),
  })
  const body = await jsonBody<{ error?: string; media_radius?: number; video_autoplay?: boolean; media_filter?: MediaDisplayFilter; media_hover?: MediaHoverEffect; mobile_grid_columns?: MobileGridColumns }>(res)
  if (!res.ok || body.media_radius == null || body.video_autoplay == null || !body.media_filter || !body.media_hover || !body.mobile_grid_columns) {
    return { ok: false, error: body.error ?? `Save failed (${res.status})` }
  }
  return { ok: true, media_radius: body.media_radius, video_autoplay: body.video_autoplay, media_filter: body.media_filter, media_hover: body.media_hover, mobile_grid_columns: body.mobile_grid_columns }
}

export async function uploadBackgroundRequest(
  slug: string,
  ownerToken: string,
  file: File,
): Promise<{ ok: true; background_theme: string } | { ok: false; error: string }> {
  const form = new FormData()
  form.set('slug', slug)
  form.set('owner_token', ownerToken)
  form.set('file', file)
  const res = await fetch('/api/album/background/upload', {
    method: 'POST',
    body: form,
  })
  const body = await jsonBody<{ error?: string; background_theme?: string }>(res)
  if (!res.ok || !body.background_theme) {
    return { ok: false, error: body.error ?? `Upload failed (${res.status})` }
  }
  return { ok: true, background_theme: body.background_theme }
}

export async function createCollectionRequest(input: {
  slug: string
  ownerToken: string
  name: string
  description: string
  collectionSlug: string
}): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const res = await fetch('/api/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      slug: input.slug,
      owner_token: input.ownerToken,
      name: input.name,
      description: input.description,
      collection_slug: input.collectionSlug,
    }),
  })
  const body = await jsonBody<{ error?: string; collection?: { slug: string } }>(res)
  if (!res.ok || !body.collection) {
    return { ok: false, error: body.error ?? `Create failed (${res.status})` }
  }
  return { ok: true, slug: body.collection.slug }
}

export async function addAlbumToCollectionRequest(
  slug: string,
  ownerToken: string,
  collectionId: string,
): Promise<{ ok: true; slug: string } | { ok: false; error: string }> {
  const res = await fetch('/api/collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, owner_token: ownerToken, collection_id: collectionId }),
  })
  const body = await jsonBody<{ error?: string; collection?: { slug: string } }>(res)
  if (!res.ok || !body.collection) {
    return { ok: false, error: body.error ?? `Add failed (${res.status})` }
  }
  return { ok: true, slug: body.collection.slug }
}

export async function deleteAlbumRequest(
  slug: string,
  ownerToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch('/api/album/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, owner_token: ownerToken }),
  })
  const body = await jsonBody<{ error?: string }>(res)
  if (!res.ok) return { ok: false, error: body.error ?? `Delete failed (${res.status})` }
  return { ok: true }
}

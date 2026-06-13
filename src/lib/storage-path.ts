export function storagePathFromPublicPhotoUrl(value: string | null): string | null {
  if (!value?.startsWith('image:')) return null
  const marker = '/storage/v1/object/public/Photos/'
  const markerIndex = value.indexOf(marker)
  if (markerIndex === -1) return null
  const path = value.slice(markerIndex + marker.length).split('?')[0]
  return path ? decodeURIComponent(path) : null
}

// Extracts the R2 object key from a background_theme that was uploaded to R2.
// Returns null if the theme is not an R2-backed custom background.
export function r2PathFromBackgroundTheme(value: string | null, publicHost: string): string | null {
  if (!value?.startsWith('image:')) return null
  const prefix = `image:https://${publicHost}/`
  if (!value.startsWith(prefix)) return null
  const path = value.slice(prefix.length)
  return path || null
}

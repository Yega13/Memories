export function storagePathFromPublicPhotoUrl(value: string | null): string | null {
  if (!value?.startsWith('image:')) return null
  const marker = '/storage/v1/object/public/Photos/'
  const markerIndex = value.indexOf(marker)
  if (markerIndex === -1) return null
  const path = value.slice(markerIndex + marker.length).split('?')[0]
  return path ? decodeURIComponent(path) : null
}

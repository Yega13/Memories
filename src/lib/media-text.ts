export const MEDIA_CAPTION_MAX = 30
export const MEDIA_AUTHOR_MAX = 16

export function mediaTextOrNull(value: unknown, max: number): string | null {
  const text = String(value ?? '').trim().slice(0, max)
  return text || null
}

import { v4 as uuidv4 } from 'uuid'

export function generateSlug(): string {
  return uuidv4().replace(/-/g, '').substring(0, 8)
}

export function generateOwnerToken(): string {
  return uuidv4().replace(/-/g, '')
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

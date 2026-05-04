export type SettingsSection = 'customization' | 'files' | 'customUrl' | 'password' | 'collection'

export type CollectionSummary = {
  id: string
  name: string
  slug: string
  album_count: number
  contains_album: boolean
}

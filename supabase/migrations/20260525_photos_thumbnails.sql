-- Add thumbnail columns to photos table.
-- thumb_path: storage path inside the Photos bucket (album_id/thumbs/<base>.<ext>)
-- thumb_url:  public CDN URL for the thumbnail
-- Both were generated client-side during upload but silently dropped on insert because these
-- columns didn't exist. PhotoGrid already falls back to the full url when thumb_url is null,
-- so existing rows are unaffected — they just continue loading full-resolution until re-uploaded.
alter table public.photos
  add column if not exists thumb_path text,
  add column if not exists thumb_url  text;

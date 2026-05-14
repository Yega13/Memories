alter table public.albums
  add column if not exists last_notification_at timestamptz,
  add column if not exists expiry_warning_sent_at timestamptz;

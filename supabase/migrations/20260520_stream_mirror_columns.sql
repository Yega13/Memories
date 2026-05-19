alter table public.photos
  add column if not exists mirror_path text,
  add column if not exists mirror_url text;

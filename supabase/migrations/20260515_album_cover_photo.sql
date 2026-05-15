alter table public.albums
  add column if not exists cover_photo_id uuid references public.photos(id) on delete set null;

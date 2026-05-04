alter table public.albums
  add column if not exists media_hover text not null default 'none';

alter table public.albums
  drop constraint if exists albums_media_hover_check;

alter table public.albums
  add constraint albums_media_hover_check
  check (media_hover in ('none', 'mono', 'fade', 'zoom', 'lift'));

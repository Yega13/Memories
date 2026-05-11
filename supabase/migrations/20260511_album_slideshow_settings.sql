alter table public.albums
  add column if not exists slideshow_interval_ms integer not null default 4200,
  add column if not exists slideshow_animation text not null default 'fade';

alter table public.albums
  drop constraint if exists albums_slideshow_interval_ms_check;

alter table public.albums
  add constraint albums_slideshow_interval_ms_check
  check (slideshow_interval_ms between 2000 and 10000);

alter table public.albums
  drop constraint if exists albums_slideshow_animation_check;

alter table public.albums
  add constraint albums_slideshow_animation_check
  check (slideshow_animation in ('none', 'fade', 'rise', 'zoom'));

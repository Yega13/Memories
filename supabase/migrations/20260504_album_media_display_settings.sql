alter table public.albums
  add column if not exists media_radius integer not null default 12,
  add column if not exists video_autoplay boolean not null default false;

alter table public.albums
  drop constraint if exists albums_media_radius_check;

alter table public.albums
  add constraint albums_media_radius_check
  check (media_radius between 0 and 36);

alter table public.photos
  add column if not exists display_radius integer,
  add column if not exists display_filter text not null default 'none';

alter table public.photos
  drop constraint if exists photos_display_radius_check;

alter table public.photos
  add constraint photos_display_radius_check
  check (display_radius is null or display_radius between 0 and 36);

alter table public.photos
  drop constraint if exists photos_display_filter_check;

alter table public.photos
  add constraint photos_display_filter_check
  check (display_filter in ('none', 'warm', 'cool', 'mono', 'vintage', 'soft'));

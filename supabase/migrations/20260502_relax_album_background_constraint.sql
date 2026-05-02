alter table public.albums
  add column if not exists background_theme text;

alter table public.albums
  drop constraint if exists albums_background_theme_check;

alter table public.albums
  add constraint albums_background_theme_check
  check (
    background_theme is null
    or char_length(background_theme) <= 2048
  );

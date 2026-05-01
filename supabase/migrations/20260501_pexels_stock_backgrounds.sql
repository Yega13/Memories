alter table public.albums
  drop constraint if exists albums_background_theme_check;

alter table public.albums
  add constraint albums_background_theme_check
  check (
    background_theme is null
    or background_theme ~ '^#[0-9A-Fa-f]{6}$'
    or background_theme in (
      'image:/wedding.jpg',
      'image:/card1.jpg',
      'image:/card2.jpg',
      'image:/card3.jpg',
      'image:/children.avif'
    )
    or background_theme ~ '^image:/backgrounds/[a-z0-9-]+[.]svg$'
    or background_theme ~ '^image:https://images[.]pexels[.]com/photos/[0-9]+/pexels-photo-[0-9]+[.](jpeg|jpg)([?].*)?$'
  );

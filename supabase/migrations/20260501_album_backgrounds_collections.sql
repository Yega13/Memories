alter table public.albums
  add column if not exists background_theme text;

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
  );

create table if not exists public.collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null unique,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collection_albums (
  collection_id uuid not null references public.collections(id) on delete cascade,
  album_id uuid not null references public.albums(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (collection_id, album_id)
);

create index if not exists collections_user_id_idx on public.collections(user_id);
create index if not exists collection_albums_album_id_idx on public.collection_albums(album_id);

alter table public.collections enable row level security;
alter table public.collection_albums enable row level security;

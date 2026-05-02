alter table public.albums
  add column if not exists last_activity_at timestamptz not null default now(),
  add column if not exists retired_at timestamptz;

create index if not exists albums_retirement_scan_idx
  on public.albums(last_activity_at)
  where retired_at is null;

update public.albums
set last_activity_at = greatest(
  coalesce(last_activity_at, created_at),
  coalesce(created_at, now())
)
where last_activity_at is null;

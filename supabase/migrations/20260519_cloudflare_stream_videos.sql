alter table public.photos
  add column if not exists stream_uid text,
  add column if not exists stream_iframe_url text,
  add column if not exists stream_thumbnail_url text;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.photos'::regclass
      and conname = 'photos_storage_backend_check'
  ) then
    alter table public.photos drop constraint photos_storage_backend_check;
  end if;
end $$;

alter table public.photos
  add constraint photos_storage_backend_check
  check (storage_backend in ('supabase', 'r2', 'stream'));

create index if not exists photos_stream_uid_idx
  on public.photos (stream_uid)
  where stream_uid is not null;

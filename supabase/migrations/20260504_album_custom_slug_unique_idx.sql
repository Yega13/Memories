create unique index if not exists albums_custom_slug_unique_idx
  on public.albums(custom_slug)
  where custom_slug is not null;

create or replace function public.ensure_album_slug_namespace_unique()
returns trigger
language plpgsql
as $$
begin
  if new.custom_slug is not null and exists (
    select 1
    from public.albums
    where id <> new.id
      and slug = new.custom_slug
  ) then
    raise unique_violation using message = 'album custom_slug conflicts with existing slug';
  end if;

  if exists (
    select 1
    from public.albums
    where id <> new.id
      and custom_slug = new.slug
  ) then
    raise unique_violation using message = 'album slug conflicts with existing custom_slug';
  end if;

  return new;
end;
$$;

drop trigger if exists ensure_album_slug_namespace_unique on public.albums;

create trigger ensure_album_slug_namespace_unique
  before insert or update of slug, custom_slug on public.albums
  for each row
  execute function public.ensure_album_slug_namespace_unique();

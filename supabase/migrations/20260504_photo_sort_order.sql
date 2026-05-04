alter table public.photos
  add column if not exists sort_order integer;

with ranked as (
  select
    id,
    row_number() over (partition by album_id order by created_at asc, id asc) - 1 as next_sort_order
  from public.photos
  where sort_order is null
)
update public.photos
set sort_order = ranked.next_sort_order
from ranked
where photos.id = ranked.id;

create index if not exists photos_album_sort_order_idx
  on public.photos(album_id, sort_order, created_at);

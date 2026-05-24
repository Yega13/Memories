-- Single-query bulk sort_order update for drag-and-drop album arrangement.
-- Replaces N individual UPDATE calls with one atomic UPDATE ... FROM unnest(),
-- so large albums never exhaust the connection pool and can never partially fail.
create or replace function batch_set_sort_order(
  p_album_id uuid,
  p_ids       uuid[],
  p_orders    int[]
)
returns void
language sql
security definer
as $$
  update photos
  set sort_order = updates.ord
  from (
    select unnest(p_ids) as id, unnest(p_orders) as ord
  ) as updates
  where photos.id       = updates.id
    and photos.album_id = p_album_id;
$$;

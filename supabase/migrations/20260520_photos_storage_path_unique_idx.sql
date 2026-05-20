create unique index if not exists photos_album_storage_path_unique_idx
  on public.photos(album_id, storage_path);

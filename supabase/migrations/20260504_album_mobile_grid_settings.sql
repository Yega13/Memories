alter table public.albums
  add column if not exists mobile_grid_columns smallint not null default 3;

alter table public.albums
  drop constraint if exists albums_mobile_grid_columns_check;

alter table public.albums
  add constraint albums_mobile_grid_columns_check
  check (mobile_grid_columns in (3, 4, 5, 6));

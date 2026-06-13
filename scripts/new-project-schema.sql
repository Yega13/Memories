-- ================================================================
-- HUSHARE — Complete database schema for new Supabase project
-- Paste this entire file into the new project's SQL Editor and run.
-- ================================================================

-- ALBUMS
CREATE TABLE IF NOT EXISTS public.albums (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  title                  text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  slug                   text        NOT NULL UNIQUE,
  custom_slug            text,
  owner_token            text        NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  background_theme       text        CHECK (background_theme IS NULL OR char_length(background_theme) <= 2048),
  last_activity_at       timestamptz NOT NULL DEFAULT now(),
  retired_at             timestamptz,
  media_radius           integer     NOT NULL DEFAULT 12 CHECK (media_radius BETWEEN 0 AND 10000),
  video_autoplay         boolean     NOT NULL DEFAULT false,
  media_filter           text        NOT NULL DEFAULT 'none' CHECK (media_filter IN ('none','warm','cool','mono','vintage','soft')),
  media_hover            text        NOT NULL DEFAULT 'none' CHECK (media_hover IN ('none','mono','fade','zoom','lift')),
  mobile_grid_columns    smallint    NOT NULL DEFAULT 3 CHECK (mobile_grid_columns IN (3,4,5,6)),
  slideshow_interval_ms  integer     NOT NULL DEFAULT 4200 CHECK (slideshow_interval_ms BETWEEN 2000 AND 10000),
  slideshow_animation    text        NOT NULL DEFAULT 'fade' CHECK (slideshow_animation IN ('none','fade','rise','zoom')),
  last_notification_at   timestamptz,
  expiry_warning_sent_at timestamptz,
  guest_uploads_enabled  boolean     NOT NULL DEFAULT true,
  allow_guest_downloads  boolean     NOT NULL DEFAULT true
  -- cover_photo_id added below after photos table exists
);

CREATE INDEX IF NOT EXISTS albums_user_id_idx          ON public.albums(user_id);
CREATE INDEX IF NOT EXISTS albums_slug_idx             ON public.albums(slug);
CREATE INDEX IF NOT EXISTS albums_retirement_scan_idx  ON public.albums(last_activity_at) WHERE retired_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS albums_custom_slug_unique_idx ON public.albums(custom_slug) WHERE custom_slug IS NOT NULL;

ALTER TABLE public.albums ENABLE ROW LEVEL SECURITY;

-- PHOTOS
CREATE TABLE IF NOT EXISTS public.photos (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  album_id              uuid        NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  storage_path          text        NOT NULL,
  storage_backend       text        NOT NULL DEFAULT 'r2' CHECK (storage_backend IN ('supabase','r2','stream')),
  url                   text        NOT NULL,
  media_type            text        NOT NULL DEFAULT 'image' CHECK (media_type IN ('image','video')),
  caption               text,
  author_name           text,
  poster_path           text,
  poster_url            text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  display_radius        integer     CHECK (display_radius IS NULL OR display_radius BETWEEN 0 AND 10000),
  display_filter        text        CHECK (display_filter IS NULL OR display_filter IN ('none','warm','cool','mono','vintage','soft')),
  sort_order            integer,
  stream_uid            text,
  stream_iframe_url     text,
  stream_thumbnail_url  text,
  mirror_path           text,
  mirror_url            text,
  thumb_path            text,
  thumb_url             text,
  duration_seconds      integer
);

-- cover_photo_id FK — added after photos table exists
ALTER TABLE public.albums ADD COLUMN IF NOT EXISTS cover_photo_id uuid REFERENCES public.photos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS photos_album_id_idx              ON public.photos(album_id);
CREATE INDEX IF NOT EXISTS photos_album_sort_order_idx      ON public.photos(album_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS photos_stream_uid_idx            ON public.photos(stream_uid) WHERE stream_uid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS photos_album_storage_path_unique_idx ON public.photos(album_id, storage_path);

ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photos REPLICA IDENTITY FULL;

-- SUBSCRIPTIONS
CREATE TABLE IF NOT EXISTS public.subscriptions (
  id                     text        PRIMARY KEY,
  user_id                uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  polar_subscription_id  text        NOT NULL,
  polar_customer_id      text        NOT NULL,
  polar_product_id       text        NOT NULL,
  tier                   text        NOT NULL CHECK (tier IN ('pro','studio')),
  status                 text        NOT NULL,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean     NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subscriptions_user_id_idx ON public.subscriptions(user_id);
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- COLLECTIONS
CREATE TABLE IF NOT EXISTS public.collections (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  slug        text        NOT NULL UNIQUE,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.collection_albums (
  collection_id uuid        NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  album_id      uuid        NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  sort_order    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, album_id)
);

CREATE INDEX IF NOT EXISTS collections_user_id_idx        ON public.collections(user_id);
CREATE INDEX IF NOT EXISTS collection_albums_album_id_idx ON public.collection_albums(album_id);
ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_albums ENABLE ROW LEVEL SECURITY;

-- RATE LIMIT EVENTS
CREATE TABLE IF NOT EXISTS public.rate_limit_events (
  id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key        text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_events_key_created ON public.rate_limit_events(key, created_at);
ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;

-- FUNCTIONS & TRIGGERS

-- Prevents custom_slug conflicting with another album's slug and vice versa
CREATE OR REPLACE FUNCTION public.ensure_album_slug_namespace_unique()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.custom_slug IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.albums WHERE id <> NEW.id AND slug = NEW.custom_slug
  ) THEN
    RAISE unique_violation USING message = 'album custom_slug conflicts with existing slug';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.albums WHERE id <> NEW.id AND custom_slug = NEW.slug
  ) THEN
    RAISE unique_violation USING message = 'album slug conflicts with existing custom_slug';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_album_slug_namespace_unique ON public.albums;
CREATE TRIGGER ensure_album_slug_namespace_unique
  BEFORE INSERT OR UPDATE OF slug, custom_slug ON public.albums
  FOR EACH ROW EXECUTE FUNCTION public.ensure_album_slug_namespace_unique();

-- Bulk sort order update (used by drag-and-drop reordering)
CREATE OR REPLACE FUNCTION public.batch_set_sort_order(
  p_album_id uuid,
  p_ids      uuid[],
  p_orders   int[]
)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.photos
  SET sort_order = updates.ord
  FROM (SELECT unnest(p_ids) AS id, unnest(p_orders) AS ord) AS updates
  WHERE photos.id = updates.id
    AND photos.album_id = p_album_id;
$$;

-- Enable REPLICA IDENTITY FULL on the photos table so Postgres writes the
-- full row (including album_id) to WAL on DELETE events, not just the PK.
-- This lets Supabase Realtime apply a server-side filter on DELETE, meaning
-- each browser only receives deletions for the album it is currently viewing
-- instead of every deletion across the entire platform.
ALTER TABLE photos REPLICA IDENTITY FULL;

-- Add a flag that lets album owners disable guest uploads.
-- Defaults to TRUE for backward compatibility: all existing albums continue
-- to allow guest uploads until the owner explicitly disables them.
ALTER TABLE albums
  ADD COLUMN IF NOT EXISTS guest_uploads_enabled boolean NOT NULL DEFAULT true;

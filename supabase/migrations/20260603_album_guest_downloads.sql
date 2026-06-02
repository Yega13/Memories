ALTER TABLE albums ADD COLUMN IF NOT EXISTS allow_guest_downloads boolean NOT NULL DEFAULT TRUE;

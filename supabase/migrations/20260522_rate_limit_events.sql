-- Rate-limit event log used by src/lib/rate-limit.ts.
-- Rows older than 1 day are useless — a cron or Supabase scheduled job can prune them,
-- but the table stays small even without pruning at current traffic levels.
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key       text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Covering index: the rate-limit query filters by key + created_at range.
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_key_created
  ON rate_limit_events (key, created_at);

-- Row-level security: this table is only ever accessed by the service-role key
-- (server-side only). Enable RLS and grant nothing to anon/authenticated roles
-- so a leaked anon key can't read or write rate-limit counters.
ALTER TABLE rate_limit_events ENABLE ROW LEVEL SECURITY;

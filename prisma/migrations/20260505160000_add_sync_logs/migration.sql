-- CreateTable: sync_logs
-- Stores the result of every scheduled (or manual) Procore sync run.

CREATE TABLE IF NOT EXISTS sync_logs (
  id            BIGSERIAL PRIMARY KEY,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  success       BOOLEAN NOT NULL DEFAULT FALSE,
  total_ms      INTEGER,
  company_id    TEXT,
  triggered_by  TEXT NOT NULL DEFAULT 'cron',  -- 'cron' | 'manual'
  steps         JSONB,                          -- per-step results array
  mv_results    JSONB,                          -- materialized view refresh results
  error         TEXT                            -- top-level error if the run crashed
);

CREATE INDEX IF NOT EXISTS sync_logs_started_at_idx ON sync_logs (started_at DESC);
CREATE INDEX IF NOT EXISTS sync_logs_company_id_idx ON sync_logs (company_id);

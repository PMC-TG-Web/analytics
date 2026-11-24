CREATE TABLE job_closeout_runs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  review_id TEXT NOT NULL REFERENCES productivity_project_reviews(id),
  cycle INTEGER NOT NULL, revision INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  folder TEXT, report JSONB, error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, claim TEXT,
  retry_at TIMESTAMPTZ NOT NULL DEFAULT now(), requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  requested_by TEXT, generated_at TIMESTAMPTZ, decided_at TIMESTAMPTZ, decided_by TEXT, note TEXT,
  UNIQUE (review_id, cycle, revision)
);
CREATE INDEX job_closeout_runs_state_retry_at_idx ON job_closeout_runs(state,retry_at);

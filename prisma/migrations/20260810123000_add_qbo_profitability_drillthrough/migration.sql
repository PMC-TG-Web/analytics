CREATE TABLE IF NOT EXISTS public.qbo_profitability_drillthrough_projects (
  id BIGSERIAL PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES public.qbo_profitability_snapshots(id) ON DELETE CASCADE,
  qbo_customer_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available',
  total NUMERIC(18,2),
  line_count INTEGER NOT NULL DEFAULT 0,
  project_name TEXT,
  fully_qualified_name TEXT,
  breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT qbo_profitability_drillthrough_snapshot_customer_key
    UNIQUE (snapshot_id, qbo_customer_id),
  CONSTRAINT qbo_profitability_drillthrough_line_count_valid
    CHECK (line_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_qbo_profitability_drillthrough_snapshot
  ON public.qbo_profitability_drillthrough_projects (snapshot_id);

CREATE TABLE public.qbo_project_exclusions (
  qbo_customer_id TEXT PRIMARY KEY,
  project_name TEXT,
  fully_qualified_name TEXT,
  reason TEXT NOT NULL DEFAULT 'not_in_progress',
  excluded_by TEXT,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_qbo_project_exclusions_full_name
  ON public.qbo_project_exclusions (fully_qualified_name);

CREATE TABLE IF NOT EXISTS public.forms_productivity_closeouts (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  procore_project_id TEXT NOT NULL,
  line_item_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'forms_closeout',
  expected_quantity NUMERIC(18, 4) NOT NULL,
  used_before NUMERIC(18, 4) NOT NULL,
  adjustment_quantity NUMERIC(18, 4) NOT NULL,
  uom TEXT,
  accounting_date DATE NOT NULL,
  status TEXT NOT NULL,
  procore_log_id TEXT,
  notes_marker TEXT NOT NULL,
  error TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT forms_productivity_closeouts_unique
    UNIQUE (company_id, procore_project_id, line_item_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_forms_productivity_closeouts_project
  ON public.forms_productivity_closeouts (company_id, procore_project_id);

CREATE INDEX IF NOT EXISTS idx_forms_productivity_closeouts_status
  ON public.forms_productivity_closeouts (status);

CREATE INDEX IF NOT EXISTS idx_forms_productivity_closeouts_log
  ON public.forms_productivity_closeouts (procore_log_id);

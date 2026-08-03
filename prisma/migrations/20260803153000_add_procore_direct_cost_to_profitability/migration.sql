ALTER TABLE public.qbo_project_profitability_rows
  ADD COLUMN IF NOT EXISTS procore_direct_cost NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS procore_direct_cost_line_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS procore_direct_cost_status TEXT,
  ADD COLUMN IF NOT EXISTS qbo_minus_procore_direct_cost NUMERIC(18,2);

ALTER TABLE public.qbo_project_profitability_rows
  ADD CONSTRAINT qbo_project_profitability_direct_cost_line_count_valid
  CHECK (procore_direct_cost_line_count >= 0);

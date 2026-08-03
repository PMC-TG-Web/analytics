CREATE TABLE IF NOT EXISTS public.qbo_profitability_snapshots (
  id TEXT PRIMARY KEY,
  source_hash TEXT NOT NULL UNIQUE,
  source_generated_at TIMESTAMPTZ NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  accounting_method TEXT NOT NULL,
  read_only BOOLEAN NOT NULL DEFAULT TRUE,
  summary JSONB NOT NULL,
  source_counts JSONB NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT qbo_profitability_snapshot_dates_valid CHECK (start_date <= end_date),
  CONSTRAINT qbo_profitability_snapshot_read_only CHECK (read_only = TRUE),
  CONSTRAINT qbo_profitability_snapshot_accounting_method CHECK (accounting_method IN ('Accrual', 'Cash'))
);

CREATE INDEX IF NOT EXISTS idx_qbo_profitability_snapshots_imported
  ON public.qbo_profitability_snapshots (imported_at DESC);
CREATE INDEX IF NOT EXISTS idx_qbo_profitability_snapshots_window
  ON public.qbo_profitability_snapshots (start_date, end_date);

CREATE TABLE IF NOT EXISTS public.qbo_project_profitability_rows (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES public.qbo_profitability_snapshots(id) ON DELETE CASCADE,
  qbo_customer_id TEXT NOT NULL,
  record_type TEXT NOT NULL,
  project_name TEXT NOT NULL,
  fully_qualified_name TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  parent_customer_id TEXT,
  procore_project_id TEXT,
  procore_project_number TEXT,
  procore_project_name TEXT,
  procore_match_method TEXT NOT NULL,
  sales NUMERIC(18,2) NOT NULL,
  cost_of_goods_sold NUMERIC(18,2) NOT NULL,
  operating_expenses NUMERIC(18,2) NOT NULL,
  other_income NUMERIC(18,2) NOT NULL,
  other_expenses NUMERIC(18,2) NOT NULL,
  actual_cost NUMERIC(18,2) NOT NULL,
  profit NUMERIC(18,2) NOT NULL,
  margin_percent NUMERIC(9,4),
  reported_net_income NUMERIC(18,2) NOT NULL,
  reconciliation_difference NUMERIC(18,2) NOT NULL,
  CONSTRAINT qbo_project_profitability_snapshot_customer_key UNIQUE (snapshot_id, qbo_customer_id),
  CONSTRAINT qbo_project_profitability_record_type CHECK (record_type IN ('project', 'customer-only', 'unassigned'))
);

CREATE INDEX IF NOT EXISTS idx_qbo_project_profitability_record_type
  ON public.qbo_project_profitability_rows (snapshot_id, record_type);
CREATE INDEX IF NOT EXISTS idx_qbo_project_profitability_match
  ON public.qbo_project_profitability_rows (snapshot_id, procore_match_method);
CREATE INDEX IF NOT EXISTS idx_qbo_project_profitability_project_name
  ON public.qbo_project_profitability_rows (snapshot_id, project_name);

CREATE TABLE IF NOT EXISTS public.procore_potential_change_orders (
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  change_order_id TEXT NOT NULL,
  contract_id TEXT,
  package_id TEXT,
  number TEXT,
  title TEXT,
  status TEXT,
  description TEXT,
  amount NUMERIC(18,4),
  source_created_at TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  payload JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, project_id, change_order_id)
);

CREATE INDEX IF NOT EXISTS idx_potential_change_orders_company_project
  ON public.procore_potential_change_orders (company_id, project_id);
CREATE INDEX IF NOT EXISTS idx_potential_change_orders_status
  ON public.procore_potential_change_orders (status);
CREATE INDEX IF NOT EXISTS idx_potential_change_orders_package
  ON public.procore_potential_change_orders (package_id);

CREATE TABLE IF NOT EXISTS public.procore_potential_change_order_lines (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  change_order_id TEXT NOT NULL,
  line_item_id TEXT NOT NULL,
  change_order_status TEXT,
  description TEXT,
  cost_code_id TEXT,
  cost_code TEXT,
  wbs_code TEXT,
  line_item_type_code TEXT,
  uom TEXT,
  quantity NUMERIC(18,4),
  unit_cost NUMERIC(18,4),
  amount NUMERIC(18,4),
  labor_hours NUMERIC(18,4),
  payload JSONB NOT NULL,
  source_created_at TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT potential_change_order_lines_unique
    UNIQUE (company_id, project_id, change_order_id, line_item_id)
);

CREATE INDEX IF NOT EXISTS idx_potential_change_order_lines_company_project
  ON public.procore_potential_change_order_lines (company_id, project_id);
CREATE INDEX IF NOT EXISTS idx_potential_change_order_lines_change_order
  ON public.procore_potential_change_order_lines (change_order_id);
CREATE INDEX IF NOT EXISTS idx_potential_change_order_lines_status
  ON public.procore_potential_change_order_lines (change_order_status);
CREATE INDEX IF NOT EXISTS idx_potential_change_order_lines_labor
  ON public.procore_potential_change_order_lines (labor_hours)
  WHERE labor_hours IS NOT NULL;

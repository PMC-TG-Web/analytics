-- Normalized estimating and approved prime change-order data for the
-- project -> commitment -> PO line analytics drill.

CREATE TABLE IF NOT EXISTS public.procore_estimate_proposals (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  bid_board_project_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  procore_project_id TEXT,
  project_name TEXT,
  customer_name TEXT,
  proposal_name TEXT,
  status TEXT,
  is_baseline_candidate BOOLEAN NOT NULL DEFAULT FALSE,
  payload JSONB NOT NULL,
  source_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT procore_estimate_proposals_company_bid_proposal_key
    UNIQUE (company_id, bid_board_project_id, proposal_id)
);

CREATE INDEX IF NOT EXISTS idx_estimate_proposals_company_project
  ON public.procore_estimate_proposals (company_id, procore_project_id);
CREATE INDEX IF NOT EXISTS idx_estimate_proposals_company_bid_board
  ON public.procore_estimate_proposals (company_id, bid_board_project_id);
CREATE INDEX IF NOT EXISTS idx_estimate_proposals_baseline
  ON public.procore_estimate_proposals (is_baseline_candidate);

CREATE TABLE IF NOT EXISTS public.procore_estimate_line_items (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  bid_board_project_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  line_item_id TEXT NOT NULL,
  procore_project_id TEXT,
  group_id TEXT,
  group_name TEXT,
  name TEXT,
  status TEXT,
  cost_code_id TEXT,
  cost_code TEXT,
  wbs_code TEXT,
  cost_item_id TEXT,
  uom TEXT,
  quantity NUMERIC(18,4),
  labor_factor NUMERIC(18,4),
  item_cost NUMERIC(18,4),
  item_sales NUMERIC(18,4),
  labor_cost NUMERIC(18,4),
  labor_sales NUMERIC(18,4),
  labor_hours NUMERIC(18,4),
  payload JSONB NOT NULL,
  source_updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT procore_estimate_lines_company_bid_proposal_line_key
    UNIQUE (company_id, bid_board_project_id, proposal_id, line_item_id)
);

CREATE INDEX IF NOT EXISTS idx_estimate_lines_company_project
  ON public.procore_estimate_line_items (company_id, procore_project_id);
CREATE INDEX IF NOT EXISTS idx_estimate_lines_proposal
  ON public.procore_estimate_line_items (company_id, bid_board_project_id, proposal_id);
CREATE INDEX IF NOT EXISTS idx_estimate_lines_cost_code
  ON public.procore_estimate_line_items (cost_code);
CREATE INDEX IF NOT EXISTS idx_estimate_lines_labor_hours
  ON public.procore_estimate_line_items (labor_hours) WHERE labor_hours IS NOT NULL;

-- The package header was previously created lazily by the sync helper. Defining
-- it here makes deployments deterministic while remaining safe for existing DBs.
CREATE TABLE IF NOT EXISTS public.procore_change_order_packages (
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  number TEXT,
  title TEXT,
  status TEXT,
  description TEXT,
  revision TEXT,
  amount NUMERIC(18,4),
  executed_on TIMESTAMPTZ,
  source_created_at TIMESTAMPTZ,
  source_updated_at TIMESTAMPTZ,
  payload JSONB NOT NULL,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (company_id, project_id, package_id)
);

CREATE INDEX IF NOT EXISTS procore_cop_project_id_idx
  ON public.procore_change_order_packages (project_id);
CREATE INDEX IF NOT EXISTS procore_cop_status_idx
  ON public.procore_change_order_packages (status);
CREATE INDEX IF NOT EXISTS procore_cop_synced_at_idx
  ON public.procore_change_order_packages (synced_at DESC);

CREATE TABLE IF NOT EXISTS public.procore_change_order_package_lines (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,
  package_id TEXT NOT NULL,
  line_item_id TEXT NOT NULL,
  package_status TEXT,
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
  CONSTRAINT procore_co_package_lines_company_project_package_line_key
    UNIQUE (company_id, project_id, package_id, line_item_id)
);

CREATE INDEX IF NOT EXISTS idx_co_package_lines_company_project
  ON public.procore_change_order_package_lines (company_id, project_id);
CREATE INDEX IF NOT EXISTS idx_co_package_lines_package
  ON public.procore_change_order_package_lines (package_id);
CREATE INDEX IF NOT EXISTS idx_co_package_lines_cost_code
  ON public.procore_change_order_package_lines (cost_code);
CREATE INDEX IF NOT EXISTS idx_co_package_lines_status
  ON public.procore_change_order_package_lines (package_status);
CREATE INDEX IF NOT EXISTS idx_co_package_lines_labor
  ON public.procore_change_order_package_lines (labor_hours) WHERE labor_hours IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.analytics_work_scopes (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  company_id TEXT NOT NULL,
  procore_project_id TEXT NOT NULL,
  scope_code TEXT NOT NULL,
  title TEXT NOT NULL,
  uom TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_work_scopes_company_project_code_key
    UNIQUE (company_id, procore_project_id, scope_code)
);

CREATE INDEX IF NOT EXISTS idx_analytics_work_scopes_project
  ON public.analytics_work_scopes (company_id, procore_project_id);

CREATE TABLE IF NOT EXISTS public.analytics_scope_source_mappings (
  id TEXT PRIMARY KEY DEFAULT (gen_random_uuid())::text,
  scope_id TEXT NOT NULL REFERENCES public.analytics_work_scopes(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  mapping_method TEXT NOT NULL DEFAULT 'manual',
  confidence NUMERIC(5,4),
  allocation_pct NUMERIC(7,6) NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_scope_mapping_scope_source_key
    UNIQUE (scope_id, source_type, source_id),
  CONSTRAINT analytics_scope_mapping_allocation_check
    CHECK (allocation_pct > 0 AND allocation_pct <= 1),
  CONSTRAINT analytics_scope_mapping_confidence_check
    CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

CREATE INDEX IF NOT EXISTS idx_analytics_scope_mapping_source
  ON public.analytics_scope_source_mappings (source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_analytics_scope_mapping_scope_active
  ON public.analytics_scope_source_mappings (scope_id, is_active);

-- One canonical contract header. The PO-specific table wins over the generic
-- commitment feed when both contain the same Procore contract.
CREATE OR REPLACE VIEW public.analytics_commitment_headers_v AS
SELECT
  po."procoreCompanyId" AS company_id,
  po."procoreProjectId" AS project_id,
  po."procoreId" AS contract_id,
  'purchase_order'::TEXT AS contract_type,
  po.number,
  po.title,
  po.status,
  po."vendorId" AS vendor_id,
  po."vendorName" AS vendor_name,
  po."originalValue"::NUMERIC AS original_value,
  po.value::NUMERIC AS current_value,
  'PurchaseOrderContract'::TEXT AS source
FROM public."PurchaseOrderContract" po
WHERE po."procoreCompanyId" IS NOT NULL
  AND po."procoreProjectId" IS NOT NULL
  AND po."procoreId" IS NOT NULL
UNION ALL
SELECT
  c."procoreCompanyId" AS company_id,
  c."procoreProjectId" AS project_id,
  c."procoreId" AS contract_id,
  'commitment'::TEXT AS contract_type,
  c.number,
  c.title,
  c.status,
  c."vendorId" AS vendor_id,
  c."vendorName" AS vendor_name,
  c."originalValue"::NUMERIC AS original_value,
  c.value::NUMERIC AS current_value,
  'CommitmentContract'::TEXT AS source
FROM public."CommitmentContract" c
WHERE c."procoreCompanyId" IS NOT NULL
  AND c."procoreProjectId" IS NOT NULL
  AND c."procoreId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public."PurchaseOrderContract" po
    WHERE po."procoreCompanyId" = c."procoreCompanyId"
      AND po."procoreProjectId" = c."procoreProjectId"
      AND po."procoreId" = c."procoreId"
  );

-- Quantity fact at the natural PO-line grain. Productivity is joined by all
-- three source identifiers so line IDs from another project cannot collide.
CREATE OR REPLACE VIEW public.analytics_po_line_productivity_v AS
WITH productivity AS (
  SELECT
    p."procoreCompanyId" AS company_id,
    p."procoreProjectId" AS project_id,
    p."lineItemId" AS line_item_id,
    SUM(COALESCE(p."quantityUsed", 0))::NUMERIC AS used_quantity,
    SUM(COALESCE(p."quantityDelivered", 0))::NUMERIC AS delivered_quantity,
    COUNT(*)::BIGINT AS productivity_log_count,
    MIN(p.date) AS first_activity_date,
    MAX(p.date) AS last_activity_date
  FROM public."ProductivityLog" p
  WHERE p."procoreCompanyId" IS NOT NULL
    AND p."procoreProjectId" IS NOT NULL
    AND p."lineItemId" IS NOT NULL
  GROUP BY p."procoreCompanyId", p."procoreProjectId", p."lineItemId"
)
SELECT
  li."procoreCompanyId" AS company_id,
  li."procoreProjectId" AS project_id,
  li."procorePurchaseOrderContractId" AS contract_id,
  li."procoreId" AS line_item_id,
  h.number AS po_number,
  h.title AS po_title,
  h.status AS po_status,
  h.vendor_name,
  li.position,
  li.description,
  li."costCode" AS cost_code,
  li."costType" AS cost_type,
  li."wbsCode" AS wbs_code,
  li.uom,
  li.quantity::NUMERIC AS expected_quantity,
  COALESCE(p.used_quantity, 0) AS used_quantity,
  COALESCE(p.delivered_quantity, 0) AS delivered_quantity,
  (COALESCE(li.quantity, 0)::NUMERIC - COALESCE(p.used_quantity, 0)) AS remaining_quantity,
  CASE
    WHEN COALESCE(li.quantity, 0) = 0 THEN NULL
    ELSE COALESCE(p.used_quantity, 0) / li.quantity::NUMERIC
  END AS quantity_complete_ratio,
  COALESCE(p.productivity_log_count, 0) AS productivity_log_count,
  p.first_activity_date,
  p.last_activity_date
FROM public."PurchaseOrderLineItemContractDetail" li
LEFT JOIN public.analytics_commitment_headers_v h
  ON h.company_id = li."procoreCompanyId"
 AND h.project_id = li."procoreProjectId"
 AND h.contract_id = li."procorePurchaseOrderContractId"
LEFT JOIN productivity p
  ON p.company_id = li."procoreCompanyId"
 AND p.project_id = li."procoreProjectId"
 AND p.line_item_id = li."procoreId"
WHERE li."procoreCompanyId" IS NOT NULL
  AND li."procoreProjectId" IS NOT NULL
  AND li."procoreId" IS NOT NULL;

-- Labor remains at project + cost-code/work-scope grain until an explicit
-- source mapping allocates it to a PO line. This prevents duplicated hours.
CREATE OR REPLACE VIEW public.analytics_labor_scope_summary_v AS
WITH ranked_baselines AS (
  SELECT
    ep.*,
    ROW_NUMBER() OVER (
      PARTITION BY ep.company_id, ep.procore_project_id
      ORDER BY ep.source_updated_at DESC NULLS LAST, ep.synced_at DESC, ep.proposal_id DESC
    ) AS baseline_rank
  FROM public.procore_estimate_proposals ep
  WHERE ep.is_baseline_candidate
    AND ep.procore_project_id IS NOT NULL
),
baseline AS (
  SELECT
    li.company_id,
    li.procore_project_id AS project_id,
    COALESCE(NULLIF(BTRIM(li.cost_code), ''), NULLIF(BTRIM(li.wbs_code), ''), '(unassigned)') AS scope_code,
    SUM(COALESCE(li.labor_hours, 0)) AS original_labor_hours
  FROM public.procore_estimate_line_items li
  JOIN ranked_baselines ep
    ON ep.company_id = li.company_id
   AND ep.bid_board_project_id = li.bid_board_project_id
   AND ep.proposal_id = li.proposal_id
   AND ep.baseline_rank = 1
  WHERE li.labor_hours IS NOT NULL
  GROUP BY li.company_id, li.procore_project_id,
    COALESCE(NULLIF(BTRIM(li.cost_code), ''), NULLIF(BTRIM(li.wbs_code), ''), '(unassigned)')
),
approved_co AS (
  SELECT
    company_id,
    project_id,
    COALESCE(NULLIF(BTRIM(cost_code), ''), NULLIF(BTRIM(wbs_code), ''), '(unassigned)') AS scope_code,
    SUM(COALESCE(labor_hours, 0)) AS approved_co_labor_hours
  FROM public.procore_change_order_package_lines
  WHERE LOWER(COALESCE(package_status, '')) IN ('approved', 'executed', 'complete', 'completed')
    AND labor_hours IS NOT NULL
  GROUP BY company_id, project_id,
    COALESCE(NULLIF(BTRIM(cost_code), ''), NULLIF(BTRIM(wbs_code), ''), '(unassigned)')
),
actual AS (
  SELECT
    t."procoreCompanyId" AS company_id,
    t."procoreProjectId" AS project_id,
    COALESCE(NULLIF(BTRIM(t."costCodeFullCode"), ''), '(unassigned)') AS scope_code,
    SUM(COALESCE(t.hours, t."totalHoursWorked", 0))::NUMERIC AS actual_hours,
    COUNT(*)::BIGINT AS timecard_count
  FROM public."TimecardEntry" t
  WHERE t."procoreCompanyId" IS NOT NULL
    AND t."procoreProjectId" IS NOT NULL
  GROUP BY t."procoreCompanyId", t."procoreProjectId",
    COALESCE(NULLIF(BTRIM(t."costCodeFullCode"), ''), '(unassigned)')
),
scope_keys AS (
  SELECT company_id, project_id, scope_code FROM baseline
  UNION
  SELECT company_id, project_id, scope_code FROM approved_co
  UNION
  SELECT company_id, project_id, scope_code FROM actual
)
SELECT
  k.company_id,
  k.project_id,
  k.scope_code,
  COALESCE(b.original_labor_hours, 0) AS original_labor_hours,
  COALESCE(c.approved_co_labor_hours, 0) AS approved_co_labor_hours,
  COALESCE(b.original_labor_hours, 0) + COALESCE(c.approved_co_labor_hours, 0) AS revised_labor_hours,
  COALESCE(a.actual_hours, 0) AS actual_hours,
  COALESCE(b.original_labor_hours, 0) + COALESCE(c.approved_co_labor_hours, 0) - COALESCE(a.actual_hours, 0) AS remaining_labor_hours,
  CASE
    WHEN COALESCE(b.original_labor_hours, 0) + COALESCE(c.approved_co_labor_hours, 0) = 0 THEN NULL
    ELSE COALESCE(a.actual_hours, 0) /
      (COALESCE(b.original_labor_hours, 0) + COALESCE(c.approved_co_labor_hours, 0))
  END AS labor_burn_ratio,
  COALESCE(a.timecard_count, 0) AS timecard_count
FROM scope_keys k
LEFT JOIN baseline b USING (company_id, project_id, scope_code)
LEFT JOIN approved_co c USING (company_id, project_id, scope_code)
LEFT JOIN actual a USING (company_id, project_id, scope_code);


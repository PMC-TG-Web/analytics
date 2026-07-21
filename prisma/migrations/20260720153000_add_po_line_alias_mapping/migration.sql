-- Preserve raw Procore productivity IDs while allowing historical/replaced
-- line IDs to roll up to a uniquely matched current PO line.

CREATE TABLE IF NOT EXISTS public.analytics_po_line_aliases (
  id BIGSERIAL PRIMARY KEY,
  company_id TEXT NOT NULL,
  procore_project_id TEXT NOT NULL,
  source_line_item_id TEXT NOT NULL,
  source_holder_id TEXT,
  source_po_number TEXT,
  target_line_item_id TEXT NOT NULL,
  target_holder_id TEXT,
  source_description TEXT,
  target_description TEXT,
  match_method TEXT NOT NULL,
  confidence NUMERIC(5,4) NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT analytics_po_line_aliases_source_key
    UNIQUE (company_id, procore_project_id, source_line_item_id),
  CONSTRAINT analytics_po_line_aliases_confidence_check
    CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS idx_po_line_alias_target
  ON public.analytics_po_line_aliases (company_id, procore_project_id, target_line_item_id);
CREATE INDEX IF NOT EXISTS idx_po_line_alias_source_holder
  ON public.analytics_po_line_aliases (source_holder_id);
CREATE INDEX IF NOT EXISTS idx_po_line_alias_target_holder
  ON public.analytics_po_line_aliases (target_holder_id);

-- Backfill only exact normalized-description matches that have exactly one
-- target line within the same company, project, and PO number. Ambiguous or
-- semantic-only matches are deliberately excluded.
WITH productivity_source AS (
  SELECT DISTINCT
    p."procoreCompanyId" AS company_id,
    p."procoreProjectId" AS project_id,
    p."lineItemId" AS source_line_id,
    p."lineItemHolderId" AS source_holder_id,
    p."lineItemHolderNumber" AS po_number,
    p."lineItemDescription" AS source_description,
    regexp_replace(
      lower(
        regexp_replace(
          regexp_replace(
            COALESCE(p."lineItemDescription", ''),
            '^#[0-9]+[[:space:]]*-[[:space:]]*',
            '',
            'i'
          ),
          '[[:space:]]*-[[:space:]]*[-+]?[0-9]+([.][0-9]+)?[[:space:]]+[^[:space:]]+[[:space:]]*$',
          '',
          'i'
        )
      ),
      '[^a-z0-9]+',
      '',
      'g'
    ) AS normalized_description
  FROM public."ProductivityLog" p
  WHERE p."procoreCompanyId" IS NOT NULL
    AND p."procoreProjectId" IS NOT NULL
    AND p."lineItemId" IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public."PurchaseOrderLineItemContractDetail" li
      WHERE li."procoreCompanyId" = p."procoreCompanyId"
        AND li."procoreProjectId" = p."procoreProjectId"
        AND li."procoreId" = p."lineItemId"
    )
),
candidate_matches AS (
  SELECT
    p.*,
    po."procoreId" AS target_holder_id,
    li."procoreId" AS target_line_id,
    li.description AS target_description,
    COUNT(*) OVER (
      PARTITION BY p.company_id, p.project_id, p.source_line_id
    ) AS candidate_count
  FROM productivity_source p
  JOIN public."PurchaseOrderContract" po
    ON po."procoreCompanyId" = p.company_id
   AND po."procoreProjectId" = p.project_id
   AND po.number = p.po_number
  JOIN public."PurchaseOrderLineItemContractDetail" li
    ON li."purchaseOrderContractId" = po.id
   AND regexp_replace(lower(COALESCE(li.description, '')), '[^a-z0-9]+', '', 'g') =
       p.normalized_description
)
INSERT INTO public.analytics_po_line_aliases (
  company_id,
  procore_project_id,
  source_line_item_id,
  source_holder_id,
  source_po_number,
  target_line_item_id,
  target_holder_id,
  source_description,
  target_description,
  match_method,
  confidence
)
SELECT
  company_id,
  project_id,
  source_line_id,
  source_holder_id,
  po_number,
  target_line_id,
  target_holder_id,
  source_description,
  target_description,
  'unique_po_normalized_description',
  1
FROM candidate_matches
WHERE candidate_count = 1
ON CONFLICT (company_id, procore_project_id, source_line_item_id)
DO UPDATE SET
  source_holder_id = EXCLUDED.source_holder_id,
  source_po_number = EXCLUDED.source_po_number,
  target_line_item_id = EXCLUDED.target_line_item_id,
  target_holder_id = EXCLUDED.target_holder_id,
  source_description = EXCLUDED.source_description,
  target_description = EXCLUDED.target_description,
  match_method = EXCLUDED.match_method,
  confidence = EXCLUDED.confidence,
  updated_at = NOW();

CREATE OR REPLACE VIEW public.analytics_po_line_productivity_v AS
WITH productivity AS (
  SELECT
    p."procoreCompanyId" AS company_id,
    p."procoreProjectId" AS project_id,
    COALESCE(a.target_line_item_id, p."lineItemId") AS line_item_id,
    SUM(COALESCE(p."quantityUsed", 0))::NUMERIC AS used_quantity,
    SUM(COALESCE(p."quantityDelivered", 0))::NUMERIC AS delivered_quantity,
    COUNT(*)::BIGINT AS productivity_log_count,
    MIN(p.date) AS first_activity_date,
    MAX(p.date) AS last_activity_date
  FROM public."ProductivityLog" p
  LEFT JOIN public.analytics_po_line_aliases a
    ON a.company_id = p."procoreCompanyId"
   AND a.procore_project_id = p."procoreProjectId"
   AND a.source_line_item_id = p."lineItemId"
  WHERE p."procoreCompanyId" IS NOT NULL
    AND p."procoreProjectId" IS NOT NULL
    AND p."lineItemId" IS NOT NULL
  GROUP BY
    p."procoreCompanyId",
    p."procoreProjectId",
    COALESCE(a.target_line_item_id, p."lineItemId")
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


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
    AND p."procoreDeletedAt" IS NULL
    AND COALESCE(p."lineItemHolderTitle", '') NOT ILIKE '%Billing File%'
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
  AND li."procoreId" IS NOT NULL
  AND COALESCE(h.title, '') NOT ILIKE '%Billing File%';

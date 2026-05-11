WITH latest_project AS (
  SELECT
    pps.procore_project_id,
    pps.project_number,
    pps.name AS project_name,
    pps.customer,
    pps.status AS project_status,
    pps.synced_at AS project_synced_at,
    pps.payload->'custom_fields'->'custom_field_598134325843850'->>'value' AS custom_contract_signed_date,
    ROW_NUMBER() OVER (
      PARTITION BY pps.procore_project_id
      ORDER BY pps.synced_at DESC
    ) AS rn
  FROM procore_project_staging pps
),
latest_feed AS (
  SELECT
    pf.procore_id,
    pf.project_number AS feed_project_number,
    pf.status AS feed_status,
    pf.synced_at AS feed_synced_at,
    ROW_NUMBER() OVER (
      PARTITION BY pf.procore_id
      ORDER BY pf.synced_at DESC
    ) AS rn
  FROM procore_project_feed pf
),
latest_prime_contract AS (
  SELECT
    pc.project_procore_id,
    pc.prime_contract_id,
    pc.number AS contract_number,
    pc.title AS contract_title,
    pc.status AS contract_status,
    pc.contract_date,
    pc.signed_contract_received_date,
    pc.execution_date,
    pc.payload->>'revised_contract_amount' AS revised_contract_amount,
    pc.payload->>'grand_total' AS grand_total,
    pc.synced_at AS contract_synced_at,
    ROW_NUMBER() OVER (
      PARTITION BY pc.project_procore_id
      ORDER BY pc.synced_at DESC
    ) AS rn
  FROM procore_prime_contracts_live pc
),
hours_budget AS (
  SELECT
    bli.project_id,
    COUNT(DISTINCT bli.cost_code) AS hours_line_count,
    SUM(COALESCE(bli.payload->>'quantity', '0')::numeric) AS budgeted_hours,
    SUM(bli.amount::numeric) AS budgeted_hours_amount
  FROM budgetlineitems bli
  LEFT JOIN cost_code_categories ccc
    ON REPLACE(bli.cost_code, '.O', '') = ccc.cost_code
  WHERE ccc.item_type = 'Labor'
    AND ccc.name NOT ILIKE '%manager%'
  GROUP BY bli.project_id
),
actual_hours AS (
  SELECT
    "procoreProjectId",
    COUNT(*) AS timecard_entries,
    COUNT(DISTINCT party) AS unique_workers,
    SUM(hours)::numeric(18,2) AS total_hours_logged
  FROM "TimecardEntry"
  GROUP BY "procoreProjectId"
),
base AS (
  SELECT
    lp.procore_project_id,
    COALESCE(lp.project_number, lf.feed_project_number) AS project_number,
    lp.project_name,
    lp.customer,
    COALESCE(lp.project_status, lf.feed_status) AS project_status,
    lpc.contract_date::text AS contract_created_date,
    lpc.contract_synced_at::text AS contract_last_updated_date,
    COALESCE(
      NULLIF(lpc.revised_contract_amount, '')::numeric,
      NULLIF(lpc.grand_total, '')::numeric
    ) AS contract_value,
    lpc.contract_number,
    lpc.contract_title,
    lpc.contract_status,
    lp.project_synced_at,
    lpc.contract_synced_at,
    COALESCE(hb.budgeted_hours, 0) AS budgeted_hours,
    COALESCE(hb.hours_line_count, 0) AS hours_line_count,
    COALESCE(ah.total_hours_logged, 0) AS actual_hours_logged
  FROM latest_project lp
  LEFT JOIN latest_feed lf
    ON lf.procore_id = lp.procore_project_id
   AND lf.rn = 1
  LEFT JOIN latest_prime_contract lpc
    ON lpc.project_procore_id = lp.procore_project_id
   AND lpc.rn = 1
  LEFT JOIN hours_budget hb
    ON hb.project_id = lp.procore_project_id
  LEFT JOIN actual_hours ah
    ON ah."procoreProjectId" = lp.procore_project_id
  WHERE lp.rn = 1
    AND COALESCE(
      NULLIF(lpc.revised_contract_amount, '')::numeric,
      NULLIF(lpc.grand_total, '')::numeric
    ) > 0
)
SELECT
  b.procore_project_id,
  b.project_number,
  b.project_name,
  b.customer,
  b.project_status,
  b.contract_created_date,
  b.contract_last_updated_date,
  b.contract_value,
  b.budgeted_hours,
  b.hours_line_count,
  b.actual_hours_logged,
  COALESCE(p_by_id.hours, p_by_num.hours, p_by_name.hours) AS hours_from_project_table,
  CASE
    WHEN p_by_id.hours IS NOT NULL THEN 'procoreId'
    WHEN p_by_num.hours IS NOT NULL THEN 'projectNumber'
    WHEN p_by_name.hours IS NOT NULL THEN 'projectName+customer'
    ELSE NULL
  END AS hours_match_source,
  b.contract_number,
  b.contract_title,
  b.contract_status,
  b.project_synced_at,
  b.contract_synced_at
FROM base b
LEFT JOIN LATERAL (
  SELECT
    p."hours" AS hours,
    p."dateUpdated",
    p."updatedAt"
  FROM "Project" p
  WHERE p."procoreId" = b.procore_project_id
  ORDER BY p."dateUpdated" DESC NULLS LAST, p."updatedAt" DESC
  LIMIT 1
) p_by_id ON TRUE
LEFT JOIN LATERAL (
  SELECT
    p."hours" AS hours,
    p."dateUpdated",
    p."updatedAt"
  FROM "Project" p
  WHERE p."projectNumber" IS NOT NULL
    AND b.project_number IS NOT NULL
    AND lower(trim(p."projectNumber")) = lower(trim(b.project_number))
  ORDER BY p."dateUpdated" DESC NULLS LAST, p."updatedAt" DESC
  LIMIT 1
) p_by_num ON TRUE
LEFT JOIN LATERAL (
  SELECT
    p."hours" AS hours,
    p."dateUpdated",
    p."updatedAt"
  FROM "Project" p
  WHERE lower(trim(coalesce(p."projectName", ''))) = lower(trim(coalesce(b.project_name, '')))
    AND lower(trim(coalesce(p."customer", ''))) = lower(trim(coalesce(b.customer, '')))
  ORDER BY p."dateUpdated" DESC NULLS LAST, p."updatedAt" DESC
  LIMIT 1
) p_by_name ON TRUE
ORDER BY b.project_synced_at DESC;
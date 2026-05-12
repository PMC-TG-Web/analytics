WITH latest_project AS (
  SELECT
    pps.procore_project_id,
    pps.project_number,
    pps.name AS project_name,
    pps.customer,
    pps.status AS project_status,
    pps.synced_at AS project_synced_at,
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
latest_bid_board AS (
  SELECT
    b.bid_board_id,
    b.procore_project_id,
    b.name AS bid_board_name,
    b.status AS bid_board_status,
    b.customer AS bid_board_customer,
    b.payload,
    b.synced_at AS bid_synced_at,
    ROW_NUMBER() OVER (
      PARTITION BY b.bid_board_id
      ORDER BY b.synced_at DESC
    ) AS rn
  FROM procore_bid_board_live b
),
bid_hours AS (
  SELECT
    bli.project_id,
    COUNT(DISTINCT bli.cost_code) AS labor_line_count,
    SUM(COALESCE(bli.payload->>'quantity', '0')::numeric) AS bid_hours,
    SUM(bli.amount::numeric) AS bid_hours_amount
  FROM budgetlineitems bli
  LEFT JOIN cost_code_categories ccc
    ON REPLACE(bli.cost_code, '.O', '') = ccc.cost_code
  WHERE ccc.item_type = 'Labor'
    AND ccc.name NOT ILIKE '%manager%'
  GROUP BY bli.project_id
),
base AS (
  SELECT
    lp.procore_project_id,
    COALESCE(lp.project_number, lf.feed_project_number) AS project_number,
    lp.project_name,
    lp.customer,
    COALESCE(lp.project_status, lf.feed_status) AS project_status,
    pbm.bid_board_id,
    lbb.bid_board_status,
    COALESCE(
      NULLIF(lbb.payload->>'created_on', '')::timestamptz,
      NULLIF(lbb.payload->>'updated_at', '')::timestamptz,
      lbb.bid_synced_at,
      lp.project_synced_at
    )::date AS bid_created_date,
    COALESCE(
      NULLIF(lbb.payload->>'updated_at', '')::timestamptz,
      lbb.bid_synced_at,
      lp.project_synced_at
    )::date AS bid_last_updated_date,
    NULLIF(lbb.payload->'stats'->>'total', '')::numeric AS bid_value,
    lbb.bid_synced_at,
    lp.project_synced_at,
    COALESCE(bh.bid_hours, 0) AS bid_hours,
    COALESCE(bh.labor_line_count, 0) AS labor_line_count,
    COALESCE(bh.bid_hours_amount, 0) AS bid_hours_amount
  FROM latest_project lp
  LEFT JOIN latest_feed lf
    ON lf.procore_id = lp.procore_project_id
   AND lf.rn = 1
  LEFT JOIN LATERAL (
    SELECT
      p."bidBoardId" AS bid_board_id
    FROM "Project" p
    WHERE p."bidBoardId" IS NOT NULL
      AND (
        p."procoreId" = lp.procore_project_id
        OR (lp.project_number IS NOT NULL AND lower(trim(p."projectNumber")) = lower(trim(lp.project_number)))
        OR (
          lower(trim(coalesce(p."projectName", ''))) = lower(trim(coalesce(lp.project_name, '')))
          AND lower(trim(coalesce(p."customer", ''))) = lower(trim(coalesce(lp.customer, '')))
        )
      )
    ORDER BY p."dateUpdated" DESC NULLS LAST, p."updatedAt" DESC
    LIMIT 1
  ) pbm ON TRUE
  LEFT JOIN latest_bid_board lbb
    ON lbb.bid_board_id = pbm.bid_board_id
   AND lbb.rn = 1
  LEFT JOIN bid_hours bh
    ON bh.project_id = lp.procore_project_id
  WHERE lp.rn = 1
)
SELECT
  date_trunc('month', b.bid_created_date)::date AS estimate_month,
  COUNT(*) AS estimate_count,
  COUNT(*) FILTER (WHERE b.bid_value IS NOT NULL) AS with_bid_value_count,
  COALESCE(SUM(COALESCE(b.bid_value, 0)), 0)::numeric(18,2) AS total_bid_value,
  COALESCE(AVG(NULLIF(b.bid_value, 0)), 0)::numeric(18,2) AS avg_bid_value,
  COALESCE(SUM(COALESCE(b.bid_hours, 0)), 0)::numeric(18,2) AS total_bid_hours,
  COALESCE(SUM(COALESCE(b.bid_hours_amount, 0)), 0)::numeric(18,2) AS total_bid_hours_amount
FROM base b
WHERE b.bid_created_date >= DATE '2026-04-01'
  AND b.bid_created_date < DATE '2026-05-01'
GROUP BY date_trunc('month', b.bid_created_date)::date
ORDER BY estimate_month;
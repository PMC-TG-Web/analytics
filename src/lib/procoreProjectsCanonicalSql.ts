export function buildCanonicalProcoreProjectsCte(paramIndex: number, cteName = "canonical_projects"): string {
  return `
    ${cteName} AS (
      SELECT
        COALESCE(s.procore_project_id, s.external_id) AS canonical_project_id,
        s.procore_project_id,
        s.external_id AS external_project_id,
        s.company_id,
        s.name AS project_name,
        COALESCE(NULLIF(TRIM(s.customer), ''), NULLIF(TRIM(bb.customer), '')) AS customer,
        COALESCE(bb.status, s.bid_board_status) AS project_status,
        COALESCE(bb.status, s.bid_board_status) AS bid_board_status,
        bb.bid_board_id,
        s.synced_at
      FROM procore_project_staging s
      LEFT JOIN LATERAL (
        SELECT
          b.bid_board_id,
          b.status,
          b.customer,
          b.synced_at
        FROM procore_bid_board_live b
        WHERE b.company_id = s.company_id
          AND b.procore_project_id = COALESCE(s.procore_project_id, s.external_id)
        ORDER BY b.synced_at DESC
        LIMIT 1
      ) bb ON TRUE
      WHERE s.source = 'procore_v1_projects'
        AND s.company_id = $${paramIndex}
        AND s.external_id IS NOT NULL
        AND s.name IS NOT NULL
    )
  `;
}

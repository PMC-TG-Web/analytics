-- Materialize budget aggregation used by projects-master query.
-- This removes repeated GROUP BY/STRING_AGG work on budgetlineitems per request.

CREATE MATERIALIZED VIEW IF NOT EXISTS budget_agg_mv AS
SELECT
    company_id,
    project_id AS canonical_project_id,
    SUM(COALESCE(amount, 0))::float AS budget_total_amount,
    COUNT(DISTINCT id)::int AS budget_line_item_count,
    STRING_AGG(
        DISTINCT NULLIF(LOWER(TRIM(COALESCE(uom, ''))), ''),
        ', '
        ORDER BY NULLIF(LOWER(TRIM(COALESCE(uom, ''))), '')
    ) AS budget_uoms
FROM budgetlineitems
WHERE company_id IS NOT NULL
  AND project_id IS NOT NULL
GROUP BY company_id, project_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_agg_mv_company_project
    ON budget_agg_mv (company_id, canonical_project_id);

CREATE INDEX IF NOT EXISTS idx_budget_agg_mv_company
    ON budget_agg_mv (company_id);

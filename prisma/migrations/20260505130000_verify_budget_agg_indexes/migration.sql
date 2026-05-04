-- Verify and add indexes on tables used in budget_agg aggregation.
--
-- Problem: The budget_agg CTE filters by company_id and groups by project_id.
-- Without proper indexes on budgetlineitems (company_id, project_id), this
-- requires a full table scan plus sort, contributing to read amplification.
--
-- Solution: Add composite covering indexes on budgetlineitems that support
-- the WHERE company_id = $1 and GROUP BY project_id access pattern.

-- Create composite index supporting budget aggregation by company and project.
-- This index covers all columns used in the budget_agg CTE, allowing index-only scans.
CREATE INDEX IF NOT EXISTS idx_budgetlineitems_company_project_amount_covering
    ON budgetlineitems (company_id, project_id)
    INCLUDE (id, amount, uom)
    WHERE company_id IS NOT NULL AND project_id IS NOT NULL;

-- Verify commitments_agg_mv index effectiveness. The materialized view already
-- has (company_id, canonical_project_id) unique index, but verify it's not stale.
-- This index is critical for the commitments_agg CTE filter: WHERE company_id = $1.
-- ANALYZE commitments_agg_mv;  -- Run manually if query plans seem suboptimal

-- Add partial index on budgetlineitems for non-NULL project_id (common in queries).
-- This reduces index size and improves cache locality.
CREATE INDEX IF NOT EXISTS idx_budgetlineitems_company_project_id_partial
    ON budgetlineitems (company_id, project_id)
    WHERE project_id IS NOT NULL;

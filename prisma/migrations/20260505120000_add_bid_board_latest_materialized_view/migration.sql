-- Create a materialized view for bid_board_latest to cache the expensive CTE result.
--
-- Problem: The bid_board_latest CTE uses DISTINCT ON (procore_project_id) with 
-- synced_at DESC ordering. Without caching, this costs 7,372 reads to return 1 row
-- per query (~60% of total query cost). By materializing this result, we can
-- dramatically reduce the per-query execution cost and shift the computation
-- overhead to refresh cycles (which can happen during low-traffic periods).
--
-- Solution: Create a materialized view indexed on (company_id, procore_project_id)
-- for O(1) lookup by company. Add a refresh tracking table to schedule refreshes.

CREATE MATERIALIZED VIEW IF NOT EXISTS bid_board_latest_mv AS
SELECT
    b.company_id,
    b.procore_project_id,
    b.bid_board_id,
    b.status,
    b.customer,
    b.synced_at
FROM procore_bid_board_live b
WHERE
    b.procore_project_id IS NOT NULL
    AND (
        b.company_id,
        b.procore_project_id,
        b.synced_at
    ) IN (
        SELECT
            company_id,
            procore_project_id,
            MAX(synced_at) AS latest_synced_at
        FROM procore_bid_board_live
        WHERE procore_project_id IS NOT NULL
        GROUP BY company_id, procore_project_id
    )
WITH DATA;

-- Create indexes to optimize lookups in the materialized view.
-- Unique index on (company_id, procore_project_id) ensures O(1) access 
-- for the typical access pattern: "get latest bid board entry for company+project".
CREATE UNIQUE INDEX IF NOT EXISTS idx_bid_board_latest_mv_company_project
    ON bid_board_latest_mv (company_id, procore_project_id);

-- Secondary index on company_id alone for queries that fetch all latest entries for a company.
CREATE INDEX IF NOT EXISTS idx_bid_board_latest_mv_company
    ON bid_board_latest_mv (company_id);

-- Create a refresh tracking table to schedule and monitor materialized view refreshes.
CREATE TABLE IF NOT EXISTS mv_refresh_log (
    id SERIAL PRIMARY KEY,
    mv_name VARCHAR(255) NOT NULL,
    last_refresh_time TIMESTAMP DEFAULT NULL,
    next_refresh_time TIMESTAMP DEFAULT NOW(),
    refresh_interval_minutes INT DEFAULT 30,
    is_active BOOLEAN DEFAULT true,
    error_message TEXT DEFAULT NULL,
    refresh_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Ensure we don't duplicate refresh tracking for the same materialized view.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_refresh_log_mv_name
    ON mv_refresh_log (mv_name)
    WHERE is_active = true;

-- Insert initial refresh tracking for bid_board_latest_mv.
INSERT INTO mv_refresh_log (mv_name, refresh_interval_minutes, is_active)
VALUES ('bid_board_latest_mv', 30, true)
ON CONFLICT (idx_mv_refresh_log_mv_name) DO NOTHING;

-- Alternative query format using explicit DISTINCT ON instead of subquery window functions
-- (in case the above materialization approach needs revision). This preserves the original
-- PostgreSQL-specific DISTINCT ON pattern while ensuring it's indexed properly.
-- 
-- DROP VIEW IF EXISTS bid_board_latest_mv;
-- CREATE MATERIALIZED VIEW bid_board_latest_mv AS
-- SELECT DISTINCT ON (b.company_id, b.procore_project_id)
--     b.company_id,
--     b.procore_project_id,
--     b.bid_board_id,
--     b.status,
--     b.customer,
--     b.synced_at
-- FROM procore_bid_board_live b
-- WHERE b.procore_project_id IS NOT NULL
-- ORDER BY b.company_id, b.procore_project_id, b.synced_at DESC
-- WITH DATA;

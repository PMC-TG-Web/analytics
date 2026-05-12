-- Create a materialized view for bid_board_latest to cache the expensive CTE result.
--
-- Problem: The bid_board_latest CTE uses DISTINCT ON (procore_project_id) with 
-- synced_at DESC ordering. Without caching, this costs 7,372 reads to return 1 row
-- per query (~60% of total query cost). By materializing this result, we can
-- dramatically reduce the per-query execution cost and shift the computation
-- overhead to refresh cycles (which can happen during low-traffic periods).
--
-- Solution: Create a materialized view using DISTINCT ON for the latest entry per project.
-- Use PostgreSQL's DISTINCT ON operator which automatically picks the first row in the
-- ORDER BY sequence, making this much simpler than a window function approach.

CREATE MATERIALIZED VIEW IF NOT EXISTS bid_board_latest_mv AS
SELECT DISTINCT ON (company_id, procore_project_id)
    company_id,
    procore_project_id,
    bid_board_id,
    status,
    customer,
    synced_at
FROM procore_bid_board_live
WHERE procore_project_id IS NOT NULL
ORDER BY company_id, procore_project_id, synced_at DESC;

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
    mv_name VARCHAR(255) NOT NULL UNIQUE,
    last_refresh_time TIMESTAMP DEFAULT NULL,
    next_refresh_time TIMESTAMP DEFAULT NOW(),
    refresh_interval_minutes INT DEFAULT 30,
    is_active BOOLEAN DEFAULT true,
    error_message TEXT DEFAULT NULL,
    refresh_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Insert initial refresh tracking for bid_board_latest_mv.
INSERT INTO mv_refresh_log (mv_name, refresh_interval_minutes, is_active)
VALUES ('bid_board_latest_mv', 30, true)
ON CONFLICT (mv_name) DO NOTHING;

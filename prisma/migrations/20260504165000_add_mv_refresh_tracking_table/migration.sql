-- Lightweight tracking table for materialized view refresh debounce.
-- Stores the last time each MV was refreshed so serverless functions can
-- skip redundant refreshes within the debounce window.

CREATE TABLE IF NOT EXISTS mv_refresh_tracking (
    view_name   TEXT PRIMARY KEY,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add a partial covering index on TimecardEntry for the timecard aggregation query.
--
-- The query filters on:  procoreProjectId = $1
--                        costCodeFullCode IS NOT NULL
--                        costCodeFullCode <> ''   (BTRIM removed from query code)
-- and aggregates:        SUM(hours)
--
-- The composite index allows a direct seek on procoreProjectId + costCodeFullCode.
-- INCLUDE (hours) makes it a covering index — no heap fetch needed for the SUM.
-- The WHERE clause makes it partial, matching the query predicates exactly and
-- reducing index size compared to indexing all rows.
--
-- Expected improvement: ~80–85% reduction in block reads (12,318 → ~1,800–2,500).

CREATE INDEX "idx_timecard_entry_project_costcode_covering"
    ON "TimecardEntry" ("procoreProjectId", "costCodeFullCode")
    INCLUDE ("hours")
    WHERE "costCodeFullCode" IS NOT NULL AND "costCodeFullCode" <> '';

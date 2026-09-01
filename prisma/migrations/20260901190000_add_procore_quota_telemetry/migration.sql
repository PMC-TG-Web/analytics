ALTER TABLE "procore_sync_controls"
  ADD COLUMN IF NOT EXISTS "rate_limit_limit" INTEGER,
  ADD COLUMN IF NOT EXISTS "rate_limit_remaining" INTEGER,
  ADD COLUMN IF NOT EXISTS "rate_limit_reset_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "rate_limit_observed_at" TIMESTAMPTZ;

UPDATE "procore_sync_project_states"
SET "failure_count" = 0,
    "last_error" = NULL,
    "locked_by" = NULL,
    "locked_until" = NULL,
    "next_run_at" = LEAST("next_run_at", CURRENT_TIMESTAMP),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "failure_count" > 0
  AND "last_error" ~* '(429|rate limit|too many requests|surpassed the max number of requests)';
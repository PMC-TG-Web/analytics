UPDATE "procore_sync_project_states"
SET "failure_count" = 0,
    "last_error" = NULL,
    "next_run_at" = LEAST("next_run_at", CURRENT_TIMESTAMP),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "failure_count" > 0
  AND "last_error" ~* '(429|rate limit|too many requests|surpassed the max number of requests)';

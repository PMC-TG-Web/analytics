CREATE TABLE IF NOT EXISTS "procore_sync_project_states" (
  "id" BIGSERIAL PRIMARY KEY,
  "company_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "dataset" TEXT NOT NULL,
  "project_number" TEXT,
  "project_name" TEXT,
  "last_attempt_at" TIMESTAMPTZ,
  "last_success_at" TIMESTAMPTZ,
  "next_run_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_until" TIMESTAMPTZ,
  "locked_by" TEXT,
  "failure_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "last_result" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "procore_sync_project_states_company_project_dataset_key"
    UNIQUE ("company_id", "project_id", "dataset")
);

CREATE INDEX IF NOT EXISTS "idx_procore_sync_project_due"
  ON "procore_sync_project_states" ("company_id", "dataset", "next_run_at");

CREATE INDEX IF NOT EXISTS "idx_procore_sync_project_locked"
  ON "procore_sync_project_states" ("locked_until");

CREATE TABLE IF NOT EXISTS "procore_sync_controls" (
  "company_id" TEXT PRIMARY KEY,
  "worker_locked_by" TEXT,
  "worker_locked_until" TIMESTAMPTZ,
  "rate_limit_until" TIMESTAMPTZ,
  "last_429_at" TIMESTAMPTZ,
  "last_error" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

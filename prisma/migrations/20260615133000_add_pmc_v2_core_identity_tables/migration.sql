-- Create the v2 PMC core tables.
-- These tables do not replace legacy tables yet; they are the clean target for
-- staged backfills and read/write migration.

CREATE TABLE "pmc_projects" (
  "company_id" TEXT NOT NULL DEFAULT '598134325805519',
  "procore_project_id" TEXT NOT NULL,
  "bid_board_id" TEXT,
  "project_number" TEXT,
  "project_name" TEXT NOT NULL,
  "customer" TEXT,
  "status" TEXT,
  "bid_board_status" TEXT,
  "project_manager" TEXT,
  "estimator" TEXT,
  "address" TEXT,
  "city" TEXT,
  "state" TEXT,
  "zip" TEXT,
  "procore_created_at" TIMESTAMPTZ(6),
  "procore_updated_at" TIMESTAMPTZ(6),
  "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "pmc_projects_pkey" PRIMARY KEY ("company_id", "procore_project_id")
);

CREATE TABLE "pmc_project_scopes" (
  "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "company_id" TEXT NOT NULL DEFAULT '598134325805519',
  "procore_project_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "start_date" DATE,
  "end_date" DATE,
  "hours" DECIMAL(10,2),
  "manpower" INTEGER,
  "scheduling_mode" TEXT NOT NULL DEFAULT 'contiguous',
  "selected_days" JSONB,
  "tasks" JSONB,
  "color" VARCHAR(7),
  "notes" TEXT,
  "predecessor_id" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "pmc_project_scopes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pmc_schedule_entries" (
  "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "company_id" TEXT NOT NULL DEFAULT '598134325805519',
  "procore_project_id" TEXT NOT NULL,
  "scope_id" TEXT,
  "date" DATE NOT NULL,
  "hours" DECIMAL(6,2) NOT NULL,
  "manpower" INTEGER,
  "foreman_id" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "pmc_schedule_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pmc_schedule_allocations" (
  "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "company_id" TEXT NOT NULL DEFAULT '598134325805519',
  "procore_project_id" TEXT NOT NULL,
  "month" VARCHAR(7) NOT NULL,
  "hours" DECIMAL(10,2) NOT NULL DEFAULT 0,
  "percent" DECIMAL(5,2),
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "pmc_schedule_allocations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pmc_sync_logs" (
  "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "company_id" TEXT NOT NULL DEFAULT '598134325805519',
  "procore_project_id" TEXT NOT NULL,
  "data_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'success',
  "rows_synced" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pmc_sync_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pmc_schedule_entries_company_project_scope_date_key"
  ON "pmc_schedule_entries"("company_id", "procore_project_id", "scope_id", "date");

CREATE UNIQUE INDEX "pmc_schedule_allocations_company_project_month_key"
  ON "pmc_schedule_allocations"("company_id", "procore_project_id", "month");

CREATE INDEX "pmc_projects_company_id_idx" ON "pmc_projects"("company_id");
CREATE INDEX "pmc_projects_procore_project_id_idx" ON "pmc_projects"("procore_project_id");
CREATE INDEX "pmc_projects_bid_board_id_idx" ON "pmc_projects"("bid_board_id");
CREATE INDEX "pmc_projects_project_number_idx" ON "pmc_projects"("project_number");
CREATE INDEX "pmc_projects_customer_idx" ON "pmc_projects"("customer");
CREATE INDEX "pmc_projects_status_idx" ON "pmc_projects"("status");
CREATE INDEX "pmc_projects_bid_board_status_idx" ON "pmc_projects"("bid_board_status");

CREATE INDEX "pmc_project_scopes_company_project_idx" ON "pmc_project_scopes"("company_id", "procore_project_id");
CREATE INDEX "pmc_project_scopes_procore_project_id_idx" ON "pmc_project_scopes"("procore_project_id");
CREATE INDEX "pmc_project_scopes_start_date_idx" ON "pmc_project_scopes"("start_date");
CREATE INDEX "pmc_project_scopes_end_date_idx" ON "pmc_project_scopes"("end_date");

CREATE INDEX "pmc_schedule_entries_company_project_idx" ON "pmc_schedule_entries"("company_id", "procore_project_id");
CREATE INDEX "pmc_schedule_entries_procore_project_id_idx" ON "pmc_schedule_entries"("procore_project_id");
CREATE INDEX "pmc_schedule_entries_date_idx" ON "pmc_schedule_entries"("date");
CREATE INDEX "pmc_schedule_entries_scope_id_idx" ON "pmc_schedule_entries"("scope_id");
CREATE INDEX "pmc_schedule_entries_source_idx" ON "pmc_schedule_entries"("source");

CREATE INDEX "pmc_schedule_allocations_company_project_idx" ON "pmc_schedule_allocations"("company_id", "procore_project_id");
CREATE INDEX "pmc_schedule_allocations_procore_project_id_idx" ON "pmc_schedule_allocations"("procore_project_id");
CREATE INDEX "pmc_schedule_allocations_month_idx" ON "pmc_schedule_allocations"("month");

CREATE INDEX "pmc_sync_logs_company_project_idx" ON "pmc_sync_logs"("company_id", "procore_project_id");
CREATE INDEX "pmc_sync_logs_procore_project_id_idx" ON "pmc_sync_logs"("procore_project_id");
CREATE INDEX "pmc_sync_logs_data_type_idx" ON "pmc_sync_logs"("data_type");
CREATE INDEX "pmc_sync_logs_synced_at_idx" ON "pmc_sync_logs"("synced_at" DESC);

ALTER TABLE "pmc_project_scopes"
  ADD CONSTRAINT "pmc_project_scopes_project_fkey"
  FOREIGN KEY ("company_id", "procore_project_id")
  REFERENCES "pmc_projects"("company_id", "procore_project_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pmc_project_scopes"
  ADD CONSTRAINT "pmc_project_scopes_predecessor_fkey"
  FOREIGN KEY ("predecessor_id")
  REFERENCES "pmc_project_scopes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pmc_schedule_entries"
  ADD CONSTRAINT "pmc_schedule_entries_project_fkey"
  FOREIGN KEY ("company_id", "procore_project_id")
  REFERENCES "pmc_projects"("company_id", "procore_project_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pmc_schedule_entries"
  ADD CONSTRAINT "pmc_schedule_entries_scope_fkey"
  FOREIGN KEY ("scope_id")
  REFERENCES "pmc_project_scopes"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pmc_schedule_allocations"
  ADD CONSTRAINT "pmc_schedule_allocations_project_fkey"
  FOREIGN KEY ("company_id", "procore_project_id")
  REFERENCES "pmc_projects"("company_id", "procore_project_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

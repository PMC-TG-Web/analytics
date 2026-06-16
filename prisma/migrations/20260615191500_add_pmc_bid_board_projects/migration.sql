CREATE TABLE IF NOT EXISTS "pmc_bid_board_projects" (
  "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "company_id" TEXT NOT NULL DEFAULT '598134325805519',
  "bid_board_id" TEXT NOT NULL,
  "procore_project_id" TEXT,
  "project_name" TEXT NOT NULL,
  "customer" TEXT,
  "status" TEXT,
  "status_raw" TEXT,
  "payload" JSONB,
  "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pmc_bid_board_projects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pmc_bid_board_projects_company_id_bid_board_id_key"
  ON "pmc_bid_board_projects"("company_id", "bid_board_id");

CREATE INDEX IF NOT EXISTS "pmc_bid_board_projects_company_id_idx"
  ON "pmc_bid_board_projects"("company_id");

CREATE INDEX IF NOT EXISTS "pmc_bid_board_projects_bid_board_id_idx"
  ON "pmc_bid_board_projects"("bid_board_id");

CREATE INDEX IF NOT EXISTS "pmc_bid_board_projects_procore_project_id_idx"
  ON "pmc_bid_board_projects"("procore_project_id");

CREATE INDEX IF NOT EXISTS "pmc_bid_board_projects_status_idx"
  ON "pmc_bid_board_projects"("status");

CREATE INDEX IF NOT EXISTS "pmc_bid_board_projects_customer_idx"
  ON "pmc_bid_board_projects"("customer");

ALTER TABLE "pmc_bid_board_projects"
  ADD COLUMN IF NOT EXISTS "customer_company_id" TEXT;

CREATE INDEX IF NOT EXISTS "pmc_bid_board_projects_customer_company_id_idx"
  ON "pmc_bid_board_projects"("customer_company_id");

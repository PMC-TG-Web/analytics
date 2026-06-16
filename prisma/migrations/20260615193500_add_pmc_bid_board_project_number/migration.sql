ALTER TABLE "pmc_bid_board_projects"
  ADD COLUMN IF NOT EXISTS "project_number" TEXT;

CREATE INDEX IF NOT EXISTS "pmc_bid_board_projects_project_number_idx"
  ON "pmc_bid_board_projects"("project_number");

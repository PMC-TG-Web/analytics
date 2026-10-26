-- Additive identity protection only: no backfill, merge, update or deletion of
-- legacy projects or their schedules/actuals occurs in this migration.
BEGIN;

CREATE TABLE "procore_legacy_project_links" (
  "company_id" TEXT NOT NULL,
  "procore_project_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "procore_legacy_project_links_pkey" PRIMARY KEY ("company_id", "procore_project_id"),
  CONSTRAINT "procore_legacy_project_links_project_id_key" UNIQUE ("project_id"),
  CONSTRAINT "procore_legacy_project_links_project_id_fkey" FOREIGN KEY ("project_id")
    REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "procore_legacy_bid_board_links" (
  "company_id" TEXT NOT NULL,
  "bid_board_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "procore_legacy_bid_board_links_pkey" PRIMARY KEY ("company_id", "bid_board_id"),
  CONSTRAINT "procore_legacy_bid_board_links_project_id_fkey" FOREIGN KEY ("project_id")
    REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "procore_legacy_bid_board_links_project_id_idx"
  ON "procore_legacy_bid_board_links"("project_id");

COMMIT;

CREATE TABLE "commitment_maker_estimate_reads" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "company_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "board_id" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "state" JSONB NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "commitment_maker_estimate_reads_expires_at_idx" ON "commitment_maker_estimate_reads"("expires_at");

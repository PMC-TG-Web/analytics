-- Immutable import snapshots; normal Procore workers do not write this table.
-- Installation does not copy data or change current KPI values.
CREATE TABLE "kpi_legacy_estimate_snapshots" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "bid_board_id" TEXT NOT NULL,
  "snapshot_hash" VARCHAR(64) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "kpi_legacy_estimate_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "kpi_legacy_estimate_snapshots_old_company" CHECK ("company_id" = '598134325658789'),
  CONSTRAINT "kpi_legacy_estimate_snapshots_hash" CHECK ("snapshot_hash" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX "kpi_legacy_estimate_identity_key"
  ON "kpi_legacy_estimate_snapshots"("company_id", "bid_board_id", "snapshot_hash");
CREATE INDEX "kpi_legacy_estimate_latest_idx"
  ON "kpi_legacy_estimate_snapshots"("company_id", "bid_board_id", "captured_at");

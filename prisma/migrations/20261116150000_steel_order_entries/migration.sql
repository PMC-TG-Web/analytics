-- Order log: one row per recorded change to a job material's ordered total.
-- steel_order_marks keeps the running total; existing totals need no backfill because
-- any amount not explained by log rows is shown as recorded before the log.
-- Additive and idempotent so it can be applied ahead of the release that reads it.
CREATE TABLE IF NOT EXISTS "steel_order_entries" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "material_id" VARCHAR(64) NOT NULL,
  "item_key" TEXT NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL,
  "estimate_quantity" DECIMAL(18,4),
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voided_by" TEXT,
  "voided_at" TIMESTAMPTZ(6),
  CONSTRAINT "steel_order_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "steel_order_entries_project_fkey" FOREIGN KEY ("company_id", "project_id")
    REFERENCES "pmc_projects"("company_id", "procore_project_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "steel_order_entries_kind_check" CHECK (
    ("kind" = 'order' AND "quantity" > 0) OR ("kind" = 'correction' AND "quantity" <> 0)
  ),
  CONSTRAINT "steel_order_entries_voided_check" CHECK (("voided_at" IS NULL) = ("voided_by" IS NULL))
);
CREATE INDEX IF NOT EXISTS "steel_order_entries_material_idx"
  ON "steel_order_entries" ("company_id", "project_id", "material_id", "created_at");

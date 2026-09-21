CREATE TABLE "qbo_cost_catalog_mappings" (
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "line_item_id" TEXT NOT NULL,
    "catalog_item_id" TEXT,
    "source_signature" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "updated_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "qbo_cost_catalog_mappings_pkey" PRIMARY KEY ("company_id", "project_id", "line_item_id")
);

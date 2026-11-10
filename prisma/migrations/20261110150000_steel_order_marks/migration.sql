CREATE TABLE "steel_order_marks" (
  "company_id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "material_id" VARCHAR(64) NOT NULL,
  "item_key" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "ordered_at" TIMESTAMPTZ(6),
  "quantity" DECIMAL(18,4),
  "updated_by" TEXT NOT NULL,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "steel_order_marks_pkey" PRIMARY KEY ("company_id", "project_id", "material_id"),
  CONSTRAINT "steel_order_marks_project_fkey" FOREIGN KEY ("company_id", "project_id")
    REFERENCES "pmc_projects"("company_id", "procore_project_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "steel_order_marks_revision_check" CHECK ("revision" > 0),
  CONSTRAINT "steel_order_marks_quantity_check" CHECK (
    ("ordered_at" IS NULL AND "quantity" IS NULL) OR
    ("ordered_at" IS NOT NULL AND "quantity" IS NOT NULL AND "quantity" > 0)
  )
);

CREATE TABLE "qbo_bill_food_totals" (
 "company_id" TEXT NOT NULL, "project_id" TEXT NOT NULL, "month" TEXT NOT NULL,
 "amount" DECIMAL(12,2) NOT NULL CHECK ("amount" >= 0), "revision" INTEGER NOT NULL DEFAULT 1,
 "updated_by" TEXT NOT NULL, "updated_at" TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY ("company_id", "project_id", "month")
);
CREATE TABLE "qbo_bill_food_total_revisions" (
 "company_id" TEXT NOT NULL, "project_id" TEXT NOT NULL, "month" TEXT NOT NULL, "revision" INTEGER NOT NULL,
 "amount" DECIMAL(12,2) NOT NULL CHECK ("amount" >= 0), "updated_by" TEXT NOT NULL,
 "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("company_id", "project_id", "month", "revision")
);

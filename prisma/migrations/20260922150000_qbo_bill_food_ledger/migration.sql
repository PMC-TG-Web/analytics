CREATE TABLE "qbo_bill_food_entries" (
 "id" TEXT PRIMARY KEY, "company_id" TEXT NOT NULL, "project_id" TEXT NOT NULL,
 "month" TEXT NOT NULL, "spent_on" TEXT NOT NULL, "note" TEXT NOT NULL DEFAULT '',
 "amount" DECIMAL(12,2) NOT NULL CHECK ("amount" >= 0),
 "created_by" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "qbo_bill_food_entries_company_id_project_id_month_idx" ON "qbo_bill_food_entries"("company_id", "project_id", "month");
-- Preserve totals entered with the original monthly-total form as opening entries.
INSERT INTO "qbo_bill_food_entries" ("id", "company_id", "project_id", "month", "spent_on", "note", "amount", "created_by", "created_at")
SELECT md5(json_build_array("company_id", "project_id", "month")::text)::uuid::text,
 "company_id", "project_id", "month", "month" || '-01', 'Opening Food total', "amount", "updated_by", "updated_at"
FROM "qbo_bill_food_totals";

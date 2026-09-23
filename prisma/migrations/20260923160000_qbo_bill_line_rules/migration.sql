CREATE TABLE "qbo_bill_line_rules" (
 "company_id" TEXT NOT NULL, "project_id" TEXT NOT NULL, "line_key" TEXT NOT NULL,
 "description" TEXT NOT NULL, "source_signature" TEXT NOT NULL, "ignored" BOOLEAN NOT NULL DEFAULT false,
 "unit_cost" DECIMAL(18,8) CHECK ("unit_cost" > 0), "reason" TEXT NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1, "updated_by" TEXT NOT NULL, "updated_at" TIMESTAMPTZ(6) NOT NULL,
 PRIMARY KEY ("company_id", "project_id", "line_key")
);
CREATE TABLE "qbo_bill_line_rule_revisions" (
 "company_id" TEXT NOT NULL, "project_id" TEXT NOT NULL, "line_key" TEXT NOT NULL,
 "revision" INTEGER NOT NULL, "rule" JSONB NOT NULL, "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("company_id", "project_id", "line_key", "revision")
);

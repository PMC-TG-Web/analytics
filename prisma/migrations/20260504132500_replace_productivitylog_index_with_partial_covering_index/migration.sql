DROP INDEX IF EXISTS "idx_productivitylog_procore_project_id";

CREATE INDEX "idx_productivitylog_project_lineitem_qty_used_partial"
ON "ProductivityLog" ("procoreProjectId", "lineItemId")
INCLUDE ("quantityUsed")
WHERE "quantityUsed" IS NOT NULL;

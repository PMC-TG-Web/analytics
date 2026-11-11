-- Preserve the estimate basis of existing full-quantity marks before allowing partial orders.
ALTER TABLE "steel_order_marks" ADD COLUMN "estimate_quantity" DECIMAL(18,4);
UPDATE "steel_order_marks" SET "estimate_quantity" = "quantity" WHERE "quantity" IS NOT NULL;
ALTER TABLE "steel_order_marks" ADD CONSTRAINT "steel_order_marks_estimate_quantity_check"
  CHECK ("estimate_quantity" IS NULL OR "estimate_quantity" > 0);

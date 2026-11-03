-- Preserve historical change-order records while tracking absence from a
-- successfully completed, company/project/prime-contract-scoped source snapshot.
ALTER TABLE "procore_change_order_packages"
  ADD COLUMN IF NOT EXISTS "missing_from_source_at" TIMESTAMPTZ;

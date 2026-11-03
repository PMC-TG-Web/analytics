-- Preserve existing pilot access while making future grants administrator-managed.
-- These were the only eligible accounts; analytics/OWNER/ADMIN/ESTIMATOR were
-- the assignments that expanded to Analytics in the previous permission policy.
-- No other user or job-title template receives the new report permission.
UPDATE "User"
SET "permissions" = array_append("permissions", 'billing-analytics'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "isActive" = true
  AND lower(btrim("email")) IN ('todd@pmcdecor.com', 'shelly@pmcdecor.com', 'david@pmcdecor.com')
  AND EXISTS (
    SELECT 1 FROM unnest("permissions") AS assigned(permission)
    WHERE lower(btrim(permission)) IN ('analytics', 'owner', 'admin', 'estimator')
  )
  AND NOT EXISTS (
    SELECT 1 FROM unnest("permissions") AS assigned(permission)
    WHERE lower(btrim(permission)) = 'billing-analytics'
  );

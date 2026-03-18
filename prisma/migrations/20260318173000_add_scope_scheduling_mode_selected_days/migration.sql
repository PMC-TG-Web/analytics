-- Add per-scope scheduling intent fields for contiguous vs specific-days mode
ALTER TABLE "ProjectScope"
ADD COLUMN IF NOT EXISTS "schedulingMode" TEXT NOT NULL DEFAULT 'contiguous',
ADD COLUMN IF NOT EXISTS "selectedDays" JSONB;

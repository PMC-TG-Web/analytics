-- Add fields to ProjectScope to link with GanttV2Scope for consolidation
-- Phase 1 of scope table consolidation

ALTER TABLE "ProjectScope" ADD COLUMN IF NOT EXISTS "notes" TEXT;
ALTER TABLE "ProjectScope" ADD COLUMN IF NOT EXISTS "predecessorScopeId" TEXT;
ALTER TABLE "ProjectScope" ADD COLUMN IF NOT EXISTS "ganttV2ScopeId" TEXT;

-- Unique constraint: one ProjectScope per GanttV2Scope
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'ProjectScope' AND indexname = 'ProjectScope_ganttV2ScopeId_key'
  ) THEN
    CREATE UNIQUE INDEX "ProjectScope_ganttV2ScopeId_key" ON "ProjectScope"("ganttV2ScopeId");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'ProjectScope' AND indexname = 'ProjectScope_ganttV2ScopeId_idx'
  ) THEN
    CREATE INDEX "ProjectScope_ganttV2ScopeId_idx" ON "ProjectScope"("ganttV2ScopeId");
  END IF;
END $$;

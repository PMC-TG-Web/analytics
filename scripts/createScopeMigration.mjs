/**
 * One-time setup: creates the Prisma migration file for adding GanttV2 link
 * fields to ProjectScope. Run once, then commit the generated files.
 *
 *   node scripts/createScopeMigration.mjs
 *
 * After running, commit and push — the migration will be applied automatically
 * during the Netlify build via `prisma migrate deploy`.
 */
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'prisma', 'migrations');
const migrationName = '20260518070000_add_gantt_scope_link_fields';
const migrationDir = join(migrationsDir, migrationName);
const migrationFile = join(migrationDir, 'migration.sql');

const sql = `-- Add fields to ProjectScope to link with GanttV2Scope for consolidation
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
`;

if (existsSync(migrationFile)) {
  console.log('Migration file already exists:', migrationFile);
  process.exit(0);
}

mkdirSync(migrationDir, { recursive: true });
writeFileSync(migrationFile, sql, 'utf8');

console.log('✅ Migration file created:', migrationFile);
console.log('');
console.log('Next steps:');
console.log('  1. git add prisma/migrations/' + migrationName);
console.log('  2. git commit -m "migration: add ganttV2ScopeId link fields to ProjectScope"');
console.log('  3. Push / deploy — Netlify will apply the migration automatically.');
console.log('');
console.log('To also run the backfill after deploy:');
console.log('  node scripts/backfill-gantt-scopes.mjs');

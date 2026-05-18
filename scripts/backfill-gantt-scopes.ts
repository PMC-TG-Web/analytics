/**
 * Phase 3 backfill: copy all existing GanttV2Scope rows into ProjectScope.
 *
 * Run once after deploying the Phase 2 dual-write bridge and the schema migration:
 *
 *   npx prisma migrate dev --name "add-gantt-scope-link-fields"
 *   npx prisma generate
 *   npx tsx scripts/backfill-gantt-scopes.ts
 *
 * The script is idempotent — re-running is safe.
 * It will not overwrite existing schedulingMode / selectedDays / tasks on ProjectScope rows
 * that were created before the GanttV2 system was introduced.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type GanttV2ScopeRow = {
  id: string;
  project_id: string;
  title: string;
  start_date: Date | null;
  end_date: Date | null;
  total_hours: number;
  crew_size: number | null;
  notes: string | null;
  predecessor_scope_id: string | null;
};

type GanttProjectRow = {
  id: string;
  customer: string | null;
  project_number: string | null;
  project_name: string;
};

function toDateString(d: Date | null): string | null {
  if (!d) return null;
  return d instanceof Date
    ? d.toISOString().slice(0, 10)
    : String(d).slice(0, 10);
}

async function main() {
  console.log('=== GanttV2Scope → ProjectScope backfill ===\n');

  // Load all GanttV2 scopes
  const scopes = await prisma.$queryRawUnsafe<GanttV2ScopeRow[]>(
    `SELECT id, project_id, title, start_date, end_date, total_hours, crew_size, notes, predecessor_scope_id
     FROM gantt_v2_scopes
     ORDER BY project_id, title`
  );

  console.log(`Found ${scopes.length} GanttV2Scope rows to process.\n`);

  // Build a project-id → jobKey lookup
  const projectIds = [...new Set(scopes.map((s) => s.project_id))];
  const projects = await prisma.$queryRawUnsafe<GanttProjectRow[]>(
    `SELECT id, customer, project_number, project_name FROM gantt_v2_projects WHERE id = ANY($1::text[])`,
    projectIds
  );

  const jobKeyByProjectId = new Map<string, string>(
    projects.map((p) => [
      p.id,
      `${p.customer || ''}~${p.project_number || ''}~${p.project_name || ''}`,
    ])
  );

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const scope of scopes) {
    const jobKey = jobKeyByProjectId.get(scope.project_id);
    if (!jobKey) {
      console.warn(`  SKIP  ${scope.id} — no project found for project_id=${scope.project_id}`);
      skipped++;
      continue;
    }

    const startDate = toDateString(scope.start_date);
    const endDate = toDateString(scope.end_date);
    const totalHours = Number(scope.total_hours || 0);

    // Check if linked by ganttV2ScopeId already
    const byGanttId = await prisma.$queryRawUnsafe<Array<{ id: string; schedulingMode: string }>>(
      `SELECT id, "schedulingMode" FROM "ProjectScope" WHERE "ganttV2ScopeId" = $1 LIMIT 1`,
      scope.id
    );

    if (byGanttId.length > 0) {
      // Already linked — update shared fields, keep scheduling params
      await prisma.$executeRawUnsafe(
        `UPDATE "ProjectScope"
         SET "jobKey" = $2, "title" = $3, "startDate" = $4, "endDate" = $5,
             "hours" = $6, "manpower" = $7, "notes" = $8, "predecessorScopeId" = $9, "updatedAt" = NOW()
         WHERE id = $1`,
        byGanttId[0].id,
        jobKey,
        scope.title,
        startDate,
        endDate,
        totalHours,
        scope.crew_size,
        scope.notes,
        scope.predecessor_scope_id
      );
      console.log(`  UPDATE (by ganttV2ScopeId) ${scope.id} — ${jobKey} / ${scope.title}`);
      updated++;
      continue;
    }

    // Fall back to jobKey+title
    const byJobTitle = await prisma.$queryRawUnsafe<Array<{ id: string; schedulingMode: string }>>(
      `SELECT id, "schedulingMode" FROM "ProjectScope" WHERE "jobKey" = $1 AND title = $2 LIMIT 1`,
      jobKey,
      scope.title
    );

    if (byJobTitle.length > 0) {
      // Existing row — link it and update non-scheduling fields
      await prisma.$executeRawUnsafe(
        `UPDATE "ProjectScope"
         SET "ganttV2ScopeId" = $2, "startDate" = $3, "endDate" = $4,
             "hours" = $5, "manpower" = $6, "notes" = $7, "predecessorScopeId" = $8, "updatedAt" = NOW()
         WHERE id = $1`,
        byJobTitle[0].id,
        scope.id,
        startDate,
        endDate,
        totalHours,
        scope.crew_size,
        scope.notes,
        scope.predecessor_scope_id
      );
      console.log(`  LINK  (by jobKey+title) ${scope.id} → ${byJobTitle[0].id} — ${jobKey} / ${scope.title}`);
      updated++;
      continue;
    }

    // No existing row — create one with defaults
    const newId = (await prisma.$queryRawUnsafe<Array<{ cuid: string }>>(`SELECT gen_random_uuid()::text AS cuid`))[0]?.cuid
      || crypto.randomUUID();

    await prisma.$executeRawUnsafe(
      `INSERT INTO "ProjectScope"
         (id, "jobKey", title, "startDate", "endDate", hours, manpower, notes, "schedulingMode",
          "predecessorScopeId", "ganttV2ScopeId", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'contiguous', $9, $10, NOW(), NOW())
       ON CONFLICT ("ganttV2ScopeId") DO NOTHING`,
      newId,
      jobKey,
      scope.title,
      startDate,
      endDate,
      totalHours,
      scope.crew_size,
      scope.notes,
      scope.predecessor_scope_id,
      scope.id
    );
    console.log(`  CREATE ${scope.id} — ${jobKey} / ${scope.title}`);
    created++;
  }

  console.log(`\n=== Backfill complete ===`);
  console.log(`  Created : ${created}`);
  console.log(`  Updated : ${updated}`);
  console.log(`  Skipped : ${skipped}`);
  console.log(`  Total   : ${scopes.length}`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

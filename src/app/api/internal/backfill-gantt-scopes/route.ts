import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

// One-time backfill endpoint — protected by CRON_SECRET.
// Call after deploying the scope consolidation migration:
//   curl -X POST https://<site>/api/internal/backfill-gantt-scopes \
//     -H "Authorization: Bearer $CRON_SECRET"
//
// Safe to call multiple times (idempotent).

function toDateString(d: unknown): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const scopes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, project_id, title, start_date, end_date, total_hours, crew_size, notes, predecessor_scope_id
       FROM gantt_v2_scopes
       ORDER BY project_id, title`
    );

    const projectIds = [...new Set(scopes.map((s) => s.project_id))];
    const projects = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, customer, project_number, project_name FROM gantt_v2_projects WHERE id = ANY($1::text[])`,
      projectIds
    );

    const jobKeyByProjectId = new Map(
      projects.map((p) => [
        p.id,
        `${p.customer || ''}~${p.project_number || ''}~${p.project_name || ''}`,
      ])
    );

    let created = 0, updated = 0, skipped = 0;

    for (const scope of scopes) {
      const jobKey = jobKeyByProjectId.get(scope.project_id);
      if (!jobKey) { skipped++; continue; }

      const startDate = toDateString(scope.start_date);
      const endDate = toDateString(scope.end_date);
      const totalHours = Number(scope.total_hours || 0);

      const byGanttId = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM "ProjectScope" WHERE "ganttV2ScopeId" = $1 LIMIT 1`,
        scope.id
      );

      if (byGanttId.length > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE "ProjectScope"
           SET "jobKey" = $2, title = $3, "startDate" = $4, "endDate" = $5,
               hours = $6, manpower = $7, notes = $8, "predecessorScopeId" = $9, "updatedAt" = NOW()
           WHERE id = $1`,
          byGanttId[0].id, jobKey, scope.title, startDate, endDate,
          totalHours, scope.crew_size, scope.notes, scope.predecessor_scope_id
        );
        updated++;
        continue;
      }

      const byJobTitle = await prisma.$queryRawUnsafe<any[]>(
        `SELECT id FROM "ProjectScope" WHERE "jobKey" = $1 AND title = $2 LIMIT 1`,
        jobKey, scope.title
      );

      if (byJobTitle.length > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE "ProjectScope"
           SET "ganttV2ScopeId" = $2, "startDate" = $3, "endDate" = $4,
               hours = $5, manpower = $6, notes = $7, "predecessorScopeId" = $8, "updatedAt" = NOW()
           WHERE id = $1`,
          byJobTitle[0].id, scope.id, startDate, endDate,
          totalHours, scope.crew_size, scope.notes, scope.predecessor_scope_id
        );
        updated++;
        continue;
      }

      const newId = randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO "ProjectScope"
           (id, "jobKey", title, "startDate", "endDate", hours, manpower, notes, "schedulingMode",
            "predecessorScopeId", "ganttV2ScopeId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'contiguous', $9, $10, NOW(), NOW())
         ON CONFLICT ("ganttV2ScopeId") DO NOTHING`,
        newId, jobKey, scope.title, startDate, endDate,
        totalHours, scope.crew_size, scope.notes, scope.predecessor_scope_id, scope.id
      );
      created++;
    }

    return NextResponse.json({
      ok: true,
      total: scopes.length,
      created,
      updated,
      skipped,
    });
  } catch (err: any) {
    console.error('Backfill failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

// Reverse backfill: creates gantt_v2_scopes entries for ProjectScope rows
// that have no ganttV2ScopeId link (i.e. scopes that only exist in short/long-term).
//
// Protected by CRON_SECRET. Idempotent — safe to run multiple times.
//
// curl -X POST https://<site>/api/internal/backfill-project-scopes-to-gantt \
//   -H "Authorization: Bearer $CRON_SECRET"

function toDateString(d: unknown): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
}

// Parse jobKey "customer~project_number~project_name" into parts
function parseJobKey(jobKey: string): { customer: string; projectNumber: string; projectName: string } {
  const parts = jobKey.split('~');
  return {
    customer: parts[0] ?? '',
    projectNumber: parts[1] ?? '',
    projectName: parts[2] ?? '',
  };
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Diagnostic: show gantt projects + scopes for a jobKey
  const jobKey = req.nextUrl.searchParams.get('jobKey');
  if (!jobKey) {
    return NextResponse.json({ error: 'Pass ?jobKey=...' }, { status: 400 });
  }

  const { customer, projectNumber, projectName } = parseJobKey(jobKey);

  const projects = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, customer, project_number, project_name, job_key, source
     FROM gantt_v2_projects
     WHERE job_key = $1
        OR (customer = $2 AND project_number = $3 AND project_name = $4)`,
    jobKey, customer, projectNumber, projectName
  );

  const results: any[] = [];
  for (const p of projects) {
    const scopes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, title, start_date, end_date, total_hours FROM gantt_v2_scopes WHERE project_id = $1`,
      p.id
    );
    results.push({ project: p, scopes });
  }

  const psRows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, title, "startDate", "endDate", hours, "ganttV2ScopeId" FROM "ProjectScope" WHERE "jobKey" = $1`,
    jobKey
  );

  return NextResponse.json({ ganttProjects: results, projectScopes: psRows });
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Clean up orphaned gantt_v2_projects rows created by a previous failed backfill run:
    // these have no scopes AND were never sourced from Procore/app (job_key was set by us)
    await prisma.$executeRawUnsafe(
      `DELETE FROM gantt_v2_projects
       WHERE id NOT IN (SELECT DISTINCT project_id FROM gantt_v2_scopes)`
    );

    // Find all ProjectScope rows with no ganttV2ScopeId link
    const unlinked = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, "jobKey", title, "startDate", "endDate", hours, manpower, notes, "predecessorScopeId"
       FROM "ProjectScope"
       WHERE "ganttV2ScopeId" IS NULL
       ORDER BY "jobKey", title`
    );

    console.log(`[reverse-backfill] Found ${unlinked.length} unlinked ProjectScope rows`);

    // Cache gantt_v2_projects by jobKey to avoid repeated queries
    const ganttProjectCache = new Map<string, string>(); // jobKey -> gantt_v2_projects.id

    let created = 0, skipped = 0;

    for (const scope of unlinked) {
      const jobKey: string = scope.jobKey;
      if (!jobKey) { skipped++; continue; }

      // Find or create the gantt_v2_projects row
      let ganttProjectId = ganttProjectCache.get(jobKey);

      if (!ganttProjectId) {
        const { customer, projectNumber, projectName } = parseJobKey(jobKey);

        // Match by job_key first (most reliable), then fall back to field-by-field
        const existing = await prisma.$queryRawUnsafe<any[]>(
          `SELECT id FROM gantt_v2_projects
           WHERE job_key = $1
              OR (customer = $2 AND project_number = $3 AND project_name = $4)
           LIMIT 1`,
          jobKey, customer, projectNumber, projectName
        );

        if (existing.length > 0) {
          ganttProjectId = existing[0].id;
        } else {
          ganttProjectId = randomUUID();
          await prisma.$executeRawUnsafe(
            `INSERT INTO gantt_v2_projects (id, customer, project_number, project_name, job_key, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW())
             ON CONFLICT DO NOTHING`,
            ganttProjectId, customer, projectNumber, projectName, jobKey
          );
          console.log(`[reverse-backfill] Created gantt project: ${jobKey}`);
        }

        ganttProjectCache.set(jobKey, ganttProjectId);
      }

      // Create the gantt_v2_scopes row
      const ganttScopeId = randomUUID();
      const startDate = toDateString(scope.startDate);
      const endDate = toDateString(scope.endDate);

      await prisma.$executeRawUnsafe(
        `INSERT INTO gantt_v2_scopes
           (id, project_id, title, start_date, end_date, total_hours, crew_size, notes, predecessor_scope_id, created_at, updated_at)
         VALUES ($1, $2, $3, CAST($4 AS date), CAST($5 AS date), $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (id) DO NOTHING`,
        ganttScopeId, ganttProjectId, scope.title,
        startDate, endDate,
        Number(scope.hours || 0), scope.manpower, scope.notes, null
      );

      // Link back: set ganttV2ScopeId on the ProjectScope row
      await prisma.$executeRawUnsafe(
        `UPDATE "ProjectScope" SET "ganttV2ScopeId" = $2, "updatedAt" = NOW() WHERE id = $1`,
        scope.id, ganttScopeId
      );

      console.log(`[reverse-backfill] Created gantt scope: ${scope.title} (${jobKey})`);
      created++;
    }

    return NextResponse.json({
      ok: true,
      total: unlinked.length,
      created,
      skipped,
    });
  } catch (err: any) {
    console.error('[reverse-backfill] Failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

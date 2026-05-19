import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type ProjectRow = {
  id: string;
  job_key: string | null;
  customer: string | null;
  project_number: string | null;
  project_name: string | null;
};

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sourceProjectId = String(req.nextUrl.searchParams.get('sourceProjectId') || '').trim();
  const customer = String(req.nextUrl.searchParams.get('customer') || '').trim();
  const projectNumber = String(req.nextUrl.searchParams.get('projectNumber') || '').trim();
  const projectName = String(req.nextUrl.searchParams.get('projectName') || '').trim();
  const dryRun = req.nextUrl.searchParams.get('dryRun') !== 'false';

  if (!sourceProjectId || !projectName) {
    return NextResponse.json({ error: 'Pass ?sourceProjectId=...&customer=...&projectNumber=...&projectName=...' }, { status: 400 });
  }

  const canonicalJobKey = `${customer}~${projectNumber}~${projectName}`;

  try {
    const sourceRows = await prisma.$queryRawUnsafe<ProjectRow[]>(
      `SELECT id, job_key, customer, project_number, project_name FROM gantt_v2_projects WHERE id = $1`,
      sourceProjectId
    );
    const source = sourceRows[0];
    if (!source) {
      return NextResponse.json({ error: 'Source project not found' }, { status: 404 });
    }

    const targetRows = await prisma.$queryRawUnsafe<ProjectRow[]>(
      `
        SELECT id, job_key, customer, project_number, project_name
        FROM gantt_v2_projects
        WHERE id <> $1
          AND COALESCE(customer, '') = $2
          AND COALESCE(project_number, '') = $3
          AND COALESCE(project_name, '') = $4
        ORDER BY created_at DESC
      `,
      sourceProjectId,
      customer,
      projectNumber,
      projectName
    );
    const target = targetRows[0] || null;

    const scopeRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM gantt_v2_scopes WHERE project_id = $1 ORDER BY id`,
      sourceProjectId
    );
    const scopeIds = scopeRows.map((row) => row.id);

    const sourceJobKey = String(source.job_key || '').trim();
    const projectScopeRows = await prisma.$queryRawUnsafe<Array<{ id: string; jobKey: string | null; ganttV2ScopeId: string | null }>>(
      `
        SELECT id, "jobKey", "ganttV2ScopeId"
        FROM "ProjectScope"
        WHERE "jobKey" = $1
           OR ($2::text[] IS NOT NULL AND "ganttV2ScopeId" = ANY($2::text[]))
      `,
      sourceJobKey,
      scopeIds.length > 0 ? scopeIds : null
    );

    if (!dryRun) {
      if (target) {
        await prisma.$executeRawUnsafe(
          `UPDATE gantt_v2_scopes SET project_id = $1 WHERE project_id = $2`,
          target.id,
          sourceProjectId
        );
      } else {
        await prisma.$executeRawUnsafe(
          `
            UPDATE gantt_v2_projects
            SET customer = $1,
                project_number = $2,
                project_name = $3,
                job_key = $4,
                updated_at = NOW()
            WHERE id = $5
          `,
          customer || null,
          projectNumber || null,
          projectName,
          canonicalJobKey,
          sourceProjectId
        );
      }

      await prisma.$executeRawUnsafe(
        `
          UPDATE "ProjectScope"
          SET "jobKey" = $1
          WHERE "jobKey" = $2
             OR ($3::text[] IS NOT NULL AND "ganttV2ScopeId" = ANY($3::text[]))
        `,
        canonicalJobKey,
        sourceJobKey,
        scopeIds.length > 0 ? scopeIds : null
      );

      if (target) {
        await prisma.$executeRawUnsafe(`DELETE FROM gantt_v2_projects WHERE id = $1`, sourceProjectId);
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      source: {
        id: source.id,
        jobKey: source.job_key,
        customer: source.customer,
        projectNumber: source.project_number,
        projectName: source.project_name,
      },
      target: target
        ? {
            id: target.id,
            jobKey: target.job_key,
            customer: target.customer,
            projectNumber: target.project_number,
            projectName: target.project_name,
          }
        : null,
      canonicalJobKey,
      scopeIds,
      projectScopeRows,
      action: target ? 'merge-into-existing-project' : 'repair-source-project-in-place',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Repair project identity failed:', error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
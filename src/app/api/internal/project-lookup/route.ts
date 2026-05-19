import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const projectNumber = String(req.nextUrl.searchParams.get('projectNumber') || '').trim();
  const projectName = String(req.nextUrl.searchParams.get('projectName') || '').trim();

  if (!projectNumber && !projectName) {
    return NextResponse.json({ error: 'Pass ?projectNumber=... or ?projectName=...' }, { status: 400 });
  }

  try {
    const likeProjectNumber = projectNumber ? `%${projectNumber}%` : null;
    const likeProjectName = projectName ? `%${projectName}%` : null;

    const ganttProjects = await prisma.$queryRawUnsafe<any[]>(
      `
        SELECT id, job_key, customer, project_number, project_name,
               CAST((SELECT COUNT(*) FROM gantt_v2_scopes WHERE project_id = p.id) AS integer) AS scope_count
        FROM gantt_v2_projects p
        WHERE ($1::text IS NULL OR COALESCE(project_number, '') ILIKE $1)
          AND ($2::text IS NULL OR COALESCE(project_name, '') ILIKE $2)
        ORDER BY project_name, project_number
      `,
      likeProjectNumber,
      likeProjectName
    );

    const projectScopes = await prisma.$queryRawUnsafe<any[]>(
      `
        SELECT id, "jobKey", title, "ganttV2ScopeId", tasks, "updatedAt"
        FROM "ProjectScope"
        WHERE ($1::text IS NULL OR COALESCE(split_part("jobKey", '~', 2), '') ILIKE $1)
          AND ($2::text IS NULL OR COALESCE(split_part("jobKey", '~', 3), '') ILIKE $2)
        ORDER BY "updatedAt" DESC NULLS LAST, title
      `,
      likeProjectNumber,
      likeProjectName
    );

    return NextResponse.json({
      ok: true,
      filters: { projectNumber, projectName },
      ganttProjects: ganttProjects.map((row) => ({
        id: row.id,
        jobKey: row.job_key,
        customer: row.customer,
        projectNumber: row.project_number,
        projectName: row.project_name,
        scopeCount: Number(row.scope_count || 0),
      })),
      projectScopes: projectScopes.map((row) => ({
        id: row.id,
        jobKey: row.jobKey,
        title: row.title,
        ganttV2ScopeId: row.ganttV2ScopeId,
        taskCount: Array.isArray(row.tasks) ? row.tasks.length : 0,
        updatedAt: row.updatedAt,
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Project lookup failed:', error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
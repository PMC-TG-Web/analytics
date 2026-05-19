import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Debug endpoint — inspect ProjectScope → gantt_v2_projects split for a given jobKey
// GET /api/internal/debug-scope-project-split?jobKey=...

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const jobKey = req.nextUrl.searchParams.get('jobKey');
  if (!jobKey) {
    return NextResponse.json({ error: 'Pass ?jobKey=...' }, { status: 400 });
  }

  try {
    const scopes = await prisma.$queryRaw<any[]>`
      SELECT ps.id, ps.title, ps."ganttV2ScopeId", ps."startDate", ps."endDate", ps.hours,
             gs.id as gantt_scope_id, gs.project_id
      FROM "ProjectScope" ps
      LEFT JOIN gantt_v2_scopes gs ON gs.id = ps."ganttV2ScopeId"
      WHERE ps."jobKey" = ${jobKey}
      ORDER BY gs.project_id, ps.title
    `;

    const projectIds = [...new Set(scopes.map((s) => s.project_id).filter(Boolean))];
    
    const projects = projectIds.length > 0
      ? await prisma.$queryRaw<any[]>`
          SELECT id, customer, project_number, project_name, job_key,
                 (SELECT COUNT(*) FROM gantt_v2_scopes WHERE project_id = gantt_v2_projects.id) as scope_count
          FROM gantt_v2_projects
          WHERE id = ANY(${projectIds}::text[])
        `
      : [];

    return NextResponse.json({
      ok: true,
      jobKey,
      projectScopeCount: scopes.length,
      ganttProjectCount: projects.length,
      ganttProjects: projects,
      scopes: scopes.map((s) => ({
        id: s.id,
        title: s.title,
        ganttV2ScopeId: s.gantt_scope_id,
        projectId: s.project_id,
        hours: s.hours,
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Scope-project split debug failed:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

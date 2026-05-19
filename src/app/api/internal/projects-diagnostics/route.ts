import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Diagnostic endpoint — returns gantt_v2_projects data quality stats.
// Protected by CRON_SECRET header.
// Call: GET /api/internal/projects-diagnostics

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [total, dupes, samples] = await Promise.all([
      prisma.$queryRaw<{ cnt: bigint }[]>`SELECT COUNT(*) as cnt FROM gantt_v2_projects`,
      prisma.$queryRaw<{ customer: string; project_number: string; project_name: string; cnt: bigint }[]>`
        SELECT customer, project_number, project_name, COUNT(*) as cnt
        FROM gantt_v2_projects
        GROUP BY customer, project_number, project_name
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
        LIMIT 50
      `,
      prisma.$queryRaw<{ id: string; job_key: string; customer: string; project_number: string; project_name: string; scope_count: bigint }[]>`
        SELECT gp.id, gp.job_key, gp.customer, gp.project_number, gp.project_name,
               COUNT(gs.id) as scope_count
        FROM gantt_v2_projects gp
        LEFT JOIN gantt_v2_scopes gs ON gs.project_id = gp.id
        WHERE (gp.customer, gp.project_number, gp.project_name) IN (
          SELECT customer, project_number, project_name
          FROM gantt_v2_projects
          GROUP BY customer, project_number, project_name
          HAVING COUNT(*) > 1
        )
        GROUP BY gp.id, gp.job_key, gp.customer, gp.project_number, gp.project_name
        ORDER BY gp.customer, gp.project_number, gp.project_name, scope_count DESC
      `,
    ]);

    return NextResponse.json({
      ok: true,
      totalProjects: Number(total[0].cnt),
      duplicateGroups: dupes.length,
      duplicates: dupes.map((d) => ({
        customer: d.customer,
        projectNumber: d.project_number,
        projectName: d.project_name,
        count: Number(d.cnt),
      })),
      duplicateProjectDetails: samples.map((s) => ({
        id: s.id,
        jobKey: s.job_key,
        customer: s.customer,
        projectNumber: s.project_number,
        projectName: s.project_name,
        scopeCount: Number(s.scope_count),
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Projects diagnostics failed:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

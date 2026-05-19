import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Debug endpoint — check for duplicate gantt_v2_projects records by exact match
// GET /api/internal/check-duplicate-projects?customer=...&project_name=...

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const customer = req.nextUrl.searchParams.get('customer') || '';
  const projectName = req.nextUrl.searchParams.get('project_name') || '';
  
  if (!customer || !projectName) {
    return NextResponse.json({ error: 'Pass ?customer=...&project_name=...' }, { status: 400 });
  }

  try {
    const projects = await prisma.$queryRaw<any[]>`
      SELECT 
        id, 
        job_key, 
        customer, 
        project_number, 
        project_name,
        (SELECT COUNT(*) FROM gantt_v2_scopes WHERE project_id = gantt_v2_projects.id)::int as scope_count
      FROM gantt_v2_projects
      WHERE customer = ${customer} AND project_name = ${projectName}
      ORDER BY created_at DESC
    `;

    return NextResponse.json({
      ok: true,
      customer,
      projectName,
      projectCount: projects.length,
      projects: projects.map(p => ({
        id: p.id,
        jobKey: p.job_key,
        projectNumber: p.project_number,
        scopeCount: Number(p.scope_count || 0),
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Check duplicate projects failed:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

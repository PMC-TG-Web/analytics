import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Merge duplicate gantt_v2_projects records and consolidate scopes
// POST /api/internal/merge-duplicate-projects?fromProjectId=...&toProjectId=...

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const fromProjectId = req.nextUrl.searchParams.get('fromProjectId');
  const toProjectId = req.nextUrl.searchParams.get('toProjectId');
  const dryRun = req.nextUrl.searchParams.get('dryRun') !== 'false';

  if (!fromProjectId || !toProjectId) {
    return NextResponse.json({ error: 'Pass ?fromProjectId=...&toProjectId=...' }, { status: 400 });
  }

  try {
    // Get both projects and their scopes
    const fromProject = await prisma.$queryRaw<any[]>`
      SELECT p.id, p.customer, p.project_name, p.project_number,
             COUNT(s.id) as scope_count
      FROM gantt_v2_projects p
      LEFT JOIN gantt_v2_scopes s ON s.project_id = p.id
      WHERE p.id = ${fromProjectId}
      GROUP BY p.id
    `;

    const toProject = await prisma.$queryRaw<any[]>`
      SELECT p.id, p.customer, p.project_name, p.project_number,
             COUNT(s.id) as scope_count
      FROM gantt_v2_projects p
      LEFT JOIN gantt_v2_scopes s ON s.project_id = p.id
      WHERE p.id = ${toProjectId}
      GROUP BY p.id
    `;

    if (fromProject.length === 0 || toProject.length === 0) {
      return NextResponse.json({ error: 'One or both projects not found' }, { status: 404 });
    }

    const from = fromProject[0];
    const to = toProject[0];

    // Get all scopes from fromProject
    const scopesToMove = await prisma.$queryRaw<any[]>`
      SELECT id FROM gantt_v2_scopes WHERE project_id = ${fromProjectId}
    `;

    const result = {
      dryRun,
      from: {
        id: from.id,
        customer: from.customer,
        projectName: from.project_name,
        projectNumber: from.project_number,
        scopeCount: Number(from.scope_count || 0),
      },
      to: {
        id: to.id,
        customer: to.customer,
        projectName: to.project_name,
        projectNumber: to.project_number,
        scopeCount: Number(to.scope_count || 0),
      },
      scopesToMove: scopesToMove.length,
    };

    if (!dryRun) {
      // Move all scopes from source to destination
      if (scopesToMove.length > 0) {
        await prisma.$executeRaw`
          UPDATE gantt_v2_scopes 
          SET project_id = ${toProjectId}
          WHERE project_id = ${fromProjectId}
        `;
      }

      // Delete the source project
      await prisma.$executeRaw`
        DELETE FROM gantt_v2_projects WHERE id = ${fromProjectId}
      `;

      result['status'] = 'merged';
      result['message'] = `Moved ${scopesToMove.length} scopes from ${from.project_number} to ${to.project_number}, deleted source project`;
    } else {
      result['status'] = 'dry-run';
      result['message'] = `Would move ${scopesToMove.length} scopes and delete source project`;
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Merge duplicate projects failed:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

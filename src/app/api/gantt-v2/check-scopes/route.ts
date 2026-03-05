import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gantt-v2/check-scopes?projectId=XXX
 */
export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json({ error: 'projectId required' }, { status: 400 });
    }

    const result: any = {};

    // Check if project exists
    const project = await prisma.$queryRawUnsafe<Array<{
      id: string;
      project_name: string;
      project_number: string | null;
    }>>(`
      SELECT id, project_name, project_number
      FROM gantt_v2_projects
      WHERE id = $1
    `, projectId);

    result.projectFound = project && project.length > 0;
    if (project && project.length > 0) {
      result.projectName = project[0].project_name;
      result.projectNumber = project[0].project_number;
    }

    // Count scopes
    const scopeCountResult = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
      SELECT COUNT(*) as count
      FROM gantt_v2_scopes
      WHERE project_id = $1
    `, projectId);

    result.scopeCount = Number(scopeCountResult[0]?.count || 0);

    // Get scopes with all details
    const scopes = await prisma.$queryRawUnsafe<Array<{
      id: string;
      title: string;
    }>>(`
      SELECT id, title
      FROM gantt_v2_scopes
      WHERE project_id = $1
    `, projectId);

    result.scopes = scopes.map(s => ({
      id: s.id.substring(0, 12) + '...',
      title: s.title,
    }));

    // Check activeSchedule
    const activeScheduleCountResult = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
      SELECT COUNT(*) as count
      FROM "ActiveSchedule"
      WHERE "jobKey" LIKE $1
    `, '%2505-WP%');

    result.activeScheduleCount = Number(activeScheduleCountResult[0]?.count || 0);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in check-scopes:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

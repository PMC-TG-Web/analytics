import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gantt-v2/debug-sync?projectId=XXX
 * 
 * Debug endpoint to see what the sync logic is finding
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const projectId = searchParams.get('projectId');

    if (!projectId) {
      return NextResponse.json(
        { error: 'projectId is required' },
        { status: 400 }
      );
    }

    const debug: any = {};

    // Get the project
    const ganttProject = await prisma.$queryRawUnsafe<Array<{
      id: string;
      project_name: string;
      project_number: string | null;
      customer: string | null;
    }>>(`
      SELECT id, project_name, project_number, customer
      FROM gantt_v2_projects
      WHERE id = $1
    `, projectId);

    if (!ganttProject || ganttProject.length === 0) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const project = ganttProject[0];
    debug.project = project;

    // Get scopes
    const scopes = await prisma.$queryRawUnsafe<Array<{
      id: string;
      title: string;
    }>>(`
      SELECT id, title
      FROM gantt_v2_scopes
      WHERE project_id = $1
    `, projectId);

    debug.scopes = scopes;
    debug.scopeCount = scopes?.length || 0;

    // Get all activeSchedule jobKeys
    const allJobKeys = await prisma.activeSchedule.findMany({
      select: { jobKey: true },
      distinct: ['jobKey'],
    });
    debug.allJobKeys = allJobKeys.map(e => e.jobKey);
    debug.totalJobKeys = allJobKeys.length;

    // Try to find matching jobKeys
    debug.searches = {};

    if (project.project_number) {
      const byProjectNumber = await prisma.activeSchedule.findMany({
        where: {
          jobKey: {
            contains: project.project_number,
          },
        },
        select: { jobKey: true },
        distinct: ['jobKey'],
      });
      debug.searches.byProjectNumber = {
        searchTerm: project.project_number,
        found: byProjectNumber.length,
        jobKeys: byProjectNumber.map(e => e.jobKey),
      };
    }

    const byProjectName = await prisma.activeSchedule.findMany({
      where: {
        jobKey: {
          contains: project.project_name.substring(0, 15),
        },
      },
      select: { jobKey: true },
      distinct: ['jobKey'],
    });
    debug.searches.byProjectName = {
      searchTerm: project.project_name.substring(0, 15),
      found: byProjectName.length,
      jobKeys: byProjectName.map(e => e.jobKey),
    };

    // Count total activeSchedule entries for Westminster
    const totalWestminsterEntries = await prisma.activeSchedule.count({
      where: {
        jobKey: {
          contains: '2505-WP',
        },
      },
    });
    debug.westminsterCheck = {
      totalEntries: totalWestminsterEntries,
    };

    return NextResponse.json(debug);
  } catch (error) {
    console.error('[DEBUG-SYNC] Error:', error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}

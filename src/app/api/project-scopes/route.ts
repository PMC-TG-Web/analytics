import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { syncProjectScopeToActiveSchedule, deleteProjectScopeFromActiveSchedule } from '@/utils/syncActiveSchedule';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const jobKey = searchParams.get('jobKey');

    // Fetch both projects and scopes in parallel
    const [projects, scopes] = await Promise.all([
      prisma.project.findMany({
        where: jobKey ? {
          OR: [
            { customer: { contains: jobKey } },
            { projectNumber: { contains: jobKey } },
            { projectName: { contains: jobKey } },
          ]
        } : undefined,
        select: {
          id: true,
          customer: true,
          projectNumber: true,
          projectName: true,
          status: true,
          hours: true,
          sales: true,
          projectArchived: true,
          cost: true,
          laborSales: true,
          laborCost: true,
          dateCreated: true,
          dateUpdated: true,
          estimator: true,
          projectManager: true,
          customFields: true,
        },
      }),
      prisma.projectScope.findMany({
        where: jobKey ? { jobKey } : undefined,
        select: {
          id: true,
          jobKey: true,
          title: true,
          startDate: true,
          endDate: true,
          manpower: true,
          hours: true,
          description: true,
          tasks: true,
        },
      }),
    ]);

    // Add jobKey to each project for consistency
    const projectsWithJobKey = projects.map(p => ({
      ...p,
      jobKey: `${p.customer || ''}~${p.projectNumber || ''}~${p.projectName || ''}`,
    }));

    return NextResponse.json({
      success: true,
      data: scopes,
      projects: projectsWithJobKey,
      scopes, // Keep for backwards compatibility
    });
  } catch (error) {
    console.error('Failed to fetch project scopes:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch project scopes' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobKey, title, startDate, endDate, manpower, hours, description, tasks } = body;

    if (!jobKey || !title) {
      return NextResponse.json(
        { success: false, error: 'jobKey and title are required' },
        { status: 400 }
      );
    }

    const scope = await prisma.projectScope.create({
      data: {
        jobKey,
        title: title.trim() || 'Scope',
        startDate: startDate || null,
        endDate: endDate || null,
        manpower: manpower !== undefined && manpower !== null ? manpower : null,
        hours: hours && hours > 0 ? hours : null,
        description: description || null,
        tasks: tasks || null,
      },
    });

    // Sync to ActiveSchedule so it appears on long-term schedule
    try {
      const syncResult = await syncProjectScopeToActiveSchedule(scope.id);
      console.log(`[project-scopes POST] Synced scope ${scope.id} to ActiveSchedule:`, syncResult);
    } catch (syncError) {
      console.error('[project-scopes POST] Failed to sync to ActiveSchedule:', syncError);
    }

    return NextResponse.json({
      success: true,
      data: scope,
    });
  } catch (error) {
    console.error('Failed to create scope:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create scope' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, title, startDate, endDate, manpower, hours, description, tasks } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const scope = await prisma.projectScope.update({
      where: { id },
      data: {
        ...(title !== undefined && { title: title.trim() || 'Scope' }),
        ...(startDate !== undefined && { startDate: startDate || null }),
        ...(endDate !== undefined && { endDate: endDate || null }),
        ...(manpower !== undefined && { manpower: manpower !== null ? manpower : null }),
        ...(hours !== undefined && { hours: hours && hours > 0 ? hours : null }),
        ...(description !== undefined && { description: description || null }),
        ...(tasks !== undefined && { tasks: tasks || null }),
      },
    });

    // Sync to ActiveSchedule so it appears on long-term schedule
    try {
      const syncResult = await syncProjectScopeToActiveSchedule(id);
      console.log(`[project-scopes PUT] Synced scope ${id} to ActiveSchedule:`, syncResult);
    } catch (syncError) {
      console.error('[project-scopes PUT] Failed to sync to ActiveSchedule:', syncError);
    }

    return NextResponse.json({
      success: true,
      data: scope,
    });
  } catch (error) {
    console.error('Failed to update scope:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update scope' },
      { status: 500 }
    );
  }
}

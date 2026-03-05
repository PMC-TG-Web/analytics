import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureGanttV2Schema } from '@/lib/ganttV2Db';

export const dynamic = 'force-dynamic';

// Helper function to sync scope to ActiveSchedule
async function syncScopeToActiveSchedule(
  scopeId: string,
  projectId: string,
  title: string,
  startDate: string | null,
  endDate: string | null,
  totalHours: number,
  crewSize: number | null
): Promise<void> {
  console.log('[SYNC] Starting sync for scope:', { scopeId, title, startDate, endDate, totalHours, crewSize });
  
  // Only sync if we have dates and hours
  if (!startDate || !endDate || totalHours <= 0) {
    console.log('[SYNC] Cleaning up: missing dates or hours');
    // If no dates/hours, clean up any existing entries
    const project = await prisma.$queryRawUnsafe<Array<{
      customer: string | null;
      project_number: string | null;
      project_name: string;
    }>>(
      `SELECT customer, project_number, project_name FROM gantt_v2_projects WHERE id = $1 LIMIT 1`,
      projectId
    );

    if (project && project.length > 0) {
      const { customer, project_number, project_name } = project[0];
      const jobKey = `${customer || ''}~${project_number || ''}~${project_name || ''}`;
      
      await prisma.activeSchedule.deleteMany({
        where: {
          jobKey,
          scopeOfWork: title,
          source: 'gantt',
        },
      });
    }
    return;
  }

  // Get project info to construct jobKey
  console.log('[SYNC] Looking up project:', projectId);
  let project;
  try {
    project = await prisma.$queryRawUnsafe<Array<{
      customer: string | null;
      project_number: string | null;
      project_name: string;
    }>>(
      `SELECT customer, project_number, project_name FROM gantt_v2_projects WHERE id = $1 LIMIT 1`,
      projectId
    );
    console.log('[SYNC] Project lookup result:', project);
  } catch (err) {
    console.error('[SYNC] Project lookup error:', err);
    return;
  }

  if (!project || project.length === 0) {
    console.error(`Project not found for scope sync: ${projectId}`);
    return;
  }

  const { customer, project_number, project_name } = project[0];
  const jobKey = `${customer || ''}~${project_number || ''}~${project_name || ''}`;
  console.log('[SYNC] Constructed jobKey:', jobKey);

  // Parse dates
  console.log('[SYNC] About to parse dates: startDate=' + startDate + ', endDate=' + endDate);
  const start = new Date(startDate);
  const end = new Date(endDate);
  console.log('[SYNC] Parsed to:', start.toISOString(), 'through', end.toISOString());
  
  // Calculate working days and hours per day
  const workingDays: Date[] = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay();
    if (dayOfWeek >= 1 && dayOfWeek <= 5) { // Monday-Friday
      workingDays.push(new Date(d));
    }
  }

  if (workingDays.length === 0) {
    console.warn(`No working days in scope ${scopeId} date range`);
    return;
  }

  const hoursPerDay = crewSize && crewSize > 0
    ? crewSize * 10 // If crew size provided, use that
    : totalHours / workingDays.length; // Otherwise distribute evenly

  const existingAssignments = await prisma.activeSchedule.findMany({
    where: {
      jobKey,
      scopeOfWork: title,
      source: 'gantt',
    },
    select: {
      date: true,
      foreman: true,
    },
  });

  const foremanByDate = new Map(
    existingAssignments
      .filter((entry) => Boolean(entry.foreman))
      .map((entry) => [entry.date, entry.foreman as string])
  );
  const defaultForeman =
    existingAssignments.find((entry) => Boolean(entry.foreman))?.foreman ?? null;

  // Delete existing entries for this scope
  await prisma.activeSchedule.deleteMany({
    where: {
      jobKey,
      scopeOfWork: title,
      source: 'gantt',
    },
  });

  // Create new entries for each working day
  for (const date of workingDays) {
    const dateStr = date.toISOString().split('T')[0];
    
    await prisma.activeSchedule.create({
      data: {
        jobKey,
        scopeOfWork: title,
        date: dateStr,
        hours: hoursPerDay,
        manpower: crewSize && crewSize > 0 ? Math.round(crewSize) : null,
        foreman: foremanByDate.get(dateStr) ?? defaultForeman,
        source: 'gantt',
      },
    });
  }
}

type RouteParams = {
  params: Promise<{ scopeId: string }>;
};

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    console.log('[PUT] Starting scope update request');
    await ensureGanttV2Schema();
    const { scopeId } = await params;
    const body = await request.json();

    const title = (body?.title || '').toString().trim();
    const startDate = (body?.startDate || '').toString().trim() || null;
    const endDate = (body?.endDate || '').toString().trim() || null;
    const totalHours = Number(body?.totalHours || 0);
    const crewSize = body?.crewSize === '' || body?.crewSize === undefined || body?.crewSize === null
      ? null
      : Number(body.crewSize);
    const notes = (body?.notes || '').toString().trim() || null;

    if (!title) {
      return NextResponse.json({ success: false, error: 'title is required' }, { status: 400 });
    }

    // Get projectId before updating
    const existingScope = await prisma.$queryRawUnsafe<Array<{ project_id: string }>>(
      `SELECT project_id FROM gantt_v2_scopes WHERE id = $1 LIMIT 1`,
      scopeId
    );

    if (!existingScope || existingScope.length === 0) {
      return NextResponse.json({ success: false, error: 'Scope not found' }, { status: 404 });
    }

    const projectId = existingScope[0].project_id;

    await prisma.$executeRawUnsafe(
      `
        UPDATE gantt_v2_scopes
        SET title = $2,
            start_date = CAST($3 AS date),
            end_date = CAST($4 AS date),
            total_hours = $5,
            crew_size = $6,
            notes = $7,
            updated_at = NOW()
        WHERE id = $1;
      `,
      scopeId,
      title,
      startDate,
      endDate,
      Number.isFinite(totalHours) ? totalHours : 0,
      crewSize,
      notes
    );

    // Sync to ActiveSchedule
    try {
      await syncScopeToActiveSchedule(
        scopeId,
        projectId,
        title,
        startDate,
        endDate,
        Number.isFinite(totalHours) ? totalHours : 0,
        crewSize
      );
      console.log('[PUT] Scope sync complete');
    } catch (syncErr) {
      console.error('[PUT] Sync error:', syncErr);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to update Gantt V2 scope: ${String(error)}` },
      { status: 500 }
    );
  }
}

export async function DELETE(_: NextRequest, { params }: RouteParams) {
  try {
    await ensureGanttV2Schema();
    const { scopeId } = await params;

    // Get scope and project info before deleting
    const scope = await prisma.$queryRawUnsafe<Array<{
      project_id: string;
      title: string;
    }>>(
      `SELECT project_id, title FROM gantt_v2_scopes WHERE id = $1 LIMIT 1`,
      scopeId
    );

    if (scope && scope.length > 0) {
      const { project_id, title } = scope[0];

      // Get project info to construct jobKey
      const project = await prisma.$queryRawUnsafe<Array<{
        customer: string | null;
        project_number: string | null;
        project_name: string;
      }>>(
        `SELECT customer, project_number, project_name FROM gantt_v2_projects WHERE id = $1 LIMIT 1`,
        project_id
      );

      if (project && project.length > 0) {
        const { customer, project_number, project_name } = project[0];
        const jobKey = `${customer || ''}~${project_number || ''}~${project_name || ''}`;

        // Delete ActiveSchedule entries for this scope
        await prisma.activeSchedule.deleteMany({
          where: {
            jobKey,
            scopeOfWork: title,
            source: 'gantt',
          },
        });
      }
    }

    // Delete the scope
    await prisma.$executeRawUnsafe(
      `DELETE FROM gantt_v2_scopes WHERE id = $1;`,
      scopeId
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to delete Gantt V2 scope: ${String(error)}` },
      { status: 500 }
    );
  }
}

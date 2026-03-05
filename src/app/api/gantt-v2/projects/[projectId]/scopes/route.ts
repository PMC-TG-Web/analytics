import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureGanttV2Schema, getGanttV2Scopes } from '@/lib/ganttV2Db';

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
    console.log('[SYNC] Skipping sync: missing dates or hours');
    return;
  }

  // Get project info to construct jobKey
  console.log('[SYNC] (POST) Looking up project:', projectId);
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
    console.log('[SYNC] (POST) Project lookup result:', project);
  } catch (err) {
    console.error('[SYNC] (POST) Project lookup error:', err);
    return;
  }

  if (!project || project.length === 0) {
    console.error(`Project not found for scope sync: ${projectId}`);
    return;
  }

  const { customer, project_number, project_name } = project[0];
  const jobKey = `${customer || ''}~${project_number || ''}~${project_name || ''}`;
  console.log('[SYNC] jobKey:', jobKey);

  // Parse dates
  const start = new Date(startDate);
  const end = new Date(endDate);
  console.log('[SYNC] Date range:', start, 'to', end);
  
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
  
  console.log('[SYNC] Working days:', workingDays.length, 'Hours per day:', hoursPerDay);

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
  const deleteResult = await prisma.activeSchedule.deleteMany({
    where: {
      jobKey,
      scopeOfWork: title,
      source: 'gantt',
    },
  });
  console.log('[SYNC] Deleted existing entries:', deleteResult.count);

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
    console.log('[SYNC] Created entry for', dateStr, 'hours:', hoursPerDay);
  }
}

type RouteParams = {
  params: Promise<{ projectId: string }>;
};

export async function GET(_: NextRequest, { params }: RouteParams) {
  try {
    await ensureGanttV2Schema();
    const { projectId } = await params;
    const scopes = await getGanttV2Scopes(projectId);
    return NextResponse.json({ success: true, data: scopes });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to load Gantt V2 scopes: ${String(error)}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    await ensureGanttV2Schema();
    const { projectId } = await params;
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

    const id = crypto.randomUUID();
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO gantt_v2_scopes (id, project_id, title, start_date, end_date, total_hours, crew_size, notes)
        VALUES ($1, $2, $3, CAST($4 AS date), CAST($5 AS date), $6, $7, $8);
      `,
      id,
      projectId,
      title,
      startDate,
      endDate,
      Number.isFinite(totalHours) ? totalHours : 0,
      crewSize,
      notes
    );

    // Sync to ActiveSchedule if dates and hours are provided
    console.log('[POST] About to sync scope for ActiveSchedule');
    await syncScopeToActiveSchedule(
      id,
      projectId,
      title,
      startDate,
      endDate,
      Number.isFinite(totalHours) ? totalHours : 0,
      crewSize
    );
    console.log('[POST] Scope sync complete');

    return NextResponse.json({
      success: true,
      data: {
        id,
        projectId,
        title,
        startDate,
        endDate,
        totalHours: Number.isFinite(totalHours) ? totalHours : 0,
        crewSize,
        notes,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: `Failed to create Gantt V2 scope: ${String(error)}` },
      { status: 500 }
    );
  }
}

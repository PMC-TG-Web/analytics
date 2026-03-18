import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { syncProjectScopeToActiveSchedule, deleteProjectScopeFromActiveSchedule } from '@/utils/syncActiveSchedule';

export const dynamic = 'force-dynamic';

type SelectedDayEntry = {
  date: string;
  hours: number;
  foreman: string | null;
};

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function toSelectedDayEntries(value: unknown): SelectedDayEntry[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return null;

  return value
    .map((row: any) => ({
      date: String(row?.date || '').trim(),
      hours: Number(row?.hours || 0),
      foreman: row?.foreman ? String(row.foreman) : null,
    }))
    .filter((row) => DATE_KEY_REGEX.test(row.date) && Number.isFinite(row.hours) && row.hours > 0);
}

function getDateKeyWeekday(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

async function validateSpecificDays(entries: SelectedDayEntry[] | null, schedulingMode: 'contiguous' | 'specific-days') {
  if (schedulingMode !== 'specific-days') return { valid: true as const };

  const selected = Array.isArray(entries) ? entries : [];
  if (selected.length === 0) {
    return { valid: false as const, error: 'specific-days mode requires at least one selected day' };
  }

  const seen = new Set<string>();
  for (const entry of selected) {
    if (!DATE_KEY_REGEX.test(entry.date)) {
      return { valid: false as const, error: `Invalid selected day format: ${entry.date}` };
    }
    if (seen.has(entry.date)) {
      return { valid: false as const, error: `Duplicate selected day: ${entry.date}` };
    }
    seen.add(entry.date);

    const day = getDateKeyWeekday(entry.date);
    if (day === 0 || day === 6) {
      return { valid: false as const, error: `Selected day is on a weekend: ${entry.date}` };
    }
  }

  const paidHolidays = await prisma.holiday.findMany({
    where: {
      isPaid: true,
      date: { in: selected.map((entry) => entry.date) },
    },
    select: { date: true },
  });

  if (paidHolidays.length > 0) {
    return {
      valid: false as const,
      error: `Selected day is a paid holiday: ${paidHolidays[0].date}`,
    };
  }

  return { valid: true as const };
}

async function ensureProjectScopeColumns() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ProjectScope"
      ADD COLUMN IF NOT EXISTS "schedulingMode" TEXT NOT NULL DEFAULT 'contiguous',
      ADD COLUMN IF NOT EXISTS "selectedDays" JSONB
  `);
}

export async function GET(request: NextRequest) {
  try {
    await ensureProjectScopeColumns();
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
          schedulingMode: true,
          selectedDays: true,
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
    const {
      jobKey,
      title,
      startDate,
      endDate,
      manpower,
      hours,
      description,
      tasks,
      schedulingMode,
      selectedDays,
      syncToActiveSchedule,
    } = body;

    const normalizedSchedulingMode =
      schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous';

    const normalizedSelectedDays = toSelectedDayEntries(selectedDays) ?? null;

    if (!jobKey || !title) {
      return NextResponse.json(
        { success: false, error: 'jobKey and title are required' },
        { status: 400 }
      );
    }

    const specificDaysValidation = await validateSpecificDays(normalizedSelectedDays, normalizedSchedulingMode);
    if (!specificDaysValidation.valid) {
      return NextResponse.json(
        { success: false, error: specificDaysValidation.error },
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
        schedulingMode: normalizedSchedulingMode,
        selectedDays: normalizedSelectedDays,
      },
    });

    const shouldSync = syncToActiveSchedule !== false;
    if (shouldSync) {
      // Sync to ActiveSchedule so it appears on long-term schedule
      try {
        const syncResult = await syncProjectScopeToActiveSchedule(scope.id);
        console.log(`[project-scopes POST] Synced scope ${scope.id} to ActiveSchedule:`, syncResult);
      } catch (syncError) {
        console.error('[project-scopes POST] Failed to sync to ActiveSchedule:', syncError);
      }
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
    const {
      id,
      title,
      startDate,
      endDate,
      manpower,
      hours,
      description,
      tasks,
      schedulingMode,
      selectedDays,
      syncToActiveSchedule,
    } = body;

    const normalizedSchedulingMode =
      schedulingMode === undefined
        ? undefined
        : (schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous');

    const normalizedSelectedDays =
      selectedDays === undefined
        ? undefined
        : (toSelectedDayEntries(selectedDays) ?? null);

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const existing = await prisma.projectScope.findUnique({
      where: { id },
      select: {
        schedulingMode: true,
        selectedDays: true,
      },
    });

    const effectiveSchedulingMode = normalizedSchedulingMode ?? (existing?.schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous');
    const effectiveSelectedDays = normalizedSelectedDays === undefined
      ? (Array.isArray(existing?.selectedDays) ? (existing?.selectedDays as SelectedDayEntry[]) : null)
      : normalizedSelectedDays;

    const specificDaysValidation = await validateSpecificDays(effectiveSelectedDays, effectiveSchedulingMode);
    if (!specificDaysValidation.valid) {
      return NextResponse.json(
        { success: false, error: specificDaysValidation.error },
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
        ...(normalizedSchedulingMode !== undefined && { schedulingMode: normalizedSchedulingMode }),
        ...(normalizedSelectedDays !== undefined && { selectedDays: normalizedSelectedDays }),
      },
    });

    const shouldSync = syncToActiveSchedule !== false;
    if (shouldSync) {
      // Sync to ActiveSchedule so it appears on long-term schedule
      try {
        const syncResult = await syncProjectScopeToActiveSchedule(id);
        console.log(`[project-scopes PUT] Synced scope ${id} to ActiveSchedule:`, syncResult);
      } catch (syncError) {
        console.error('[project-scopes PUT] Failed to sync to ActiveSchedule:', syncError);
      }
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

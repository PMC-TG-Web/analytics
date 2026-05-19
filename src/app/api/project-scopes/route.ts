import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { syncProjectScopeToActiveSchedule, deleteProjectScopeFromActiveSchedule } from '@/utils/syncActiveSchedule';
import { getErrorMessage, shouldFallbackToEmptyRead, withDatabaseRetry } from '@/lib/dbResilience';
import { buildSearchParamsCacheKey, getCachedValue, invalidateCacheByPrefix, setCachedValue } from '@/lib/serverReadCache';

export const dynamic = 'force-dynamic';

const PROJECT_SCOPES_CACHE_PREFIX = 'project-scopes:';
const PROJECT_SCOPES_CACHE_TTL_MS = 30 * 1000;

type SelectedDayEntry = {
  date: string;
  hours: number;
  foreman: string | null;
};

type ScopeTaskEntry = {
  name: string;
  startDate?: string;
  days?: number | null;
  manpower?: number | null;
  yards?: number | null;
  concreteConfirmed?: boolean;
};

type ProjectScopeRow = {
  id: string;
  ganttV2ScopeId: string | null;
  jobKey: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  manpower: number | null;
  hours: number | null;
  description: string | null;
  tasks: unknown;
  schedulingMode: string | null;
  selectedDays: unknown;
  color: string | null;
  taskColors: unknown;
};

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNullableJsonInput(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return value === null || value === undefined
    ? Prisma.DbNull
    : value as Prisma.InputJsonValue;
}

function normalizeColor(value: unknown): string | null {
  if (value === undefined || value === null) return null;

  const color = String(value).trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
}

function toSelectedDayEntries(value: unknown): SelectedDayEntry[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return null;

  return value
    .filter(isRecord)
    .map((row) => ({
      date: String(row.date || '').trim(),
      hours: Number(row.hours || 0),
      foreman: row.foreman ? String(row.foreman) : null,
    }))
    .filter((row) => DATE_KEY_REGEX.test(row.date) && Number.isFinite(row.hours) && row.hours > 0);
}

function getDateKeyWeekday(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function normalizeScopeTasks(value: unknown): ScopeTaskEntry[] | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return null;

  const parseStringTask = (raw: string): ScopeTaskEntry | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const match = trimmed.match(/^\[([^\]]+)\]\s*(.+)$/);
    if (!match) return { name: trimmed };

    const metadata = String(match[1] || '');
    const name = String(match[2] || '').trim();
    if (!name) return null;

    const parts = metadata.split('|').map((part) => part.trim());
    const startDate = parts.find((part) => DATE_KEY_REGEX.test(part));
    const daysPart = parts.find((part) => /\d+\s*d$/i.test(part));
    const daysValue = daysPart ? Number(daysPart.replace(/[^0-9]/g, '')) : null;

    let yardsValue: number | null = null;
    for (const part of parts) {
      if (DATE_KEY_REGEX.test(part)) continue;
      if (/\d+\s*d$/i.test(part)) continue;
      const numericMatch = part.match(/(\d+(?:\.\d+)?)/);
      if (!numericMatch) continue;
      const parsed = Number.parseFloat(numericMatch[1]);
      if (!Number.isFinite(parsed) || parsed < 0) continue;
      yardsValue = parsed;
      break;
    }

    return {
      name,
      ...(startDate ? { startDate } : {}),
      ...(Number.isFinite(daysValue || 0) && (daysValue || 0) > 0 ? { days: Math.round(daysValue as number) } : {}),
      ...(Number.isFinite(yardsValue || 0) && (yardsValue || 0) >= 0 ? { yards: yardsValue as number } : {}),
      ...(Number.isFinite(yardsValue || 0) && (yardsValue || 0) > 0 ? { concreteConfirmed: false } : {}),
    };
  };

  return value
    .map((entry): ScopeTaskEntry | null => {
      if (typeof entry === 'string') {
        return parseStringTask(entry);
      }
      if (!isRecord(entry)) return null;

      const row = entry;
      const name = String(row.name || '').trim();
      if (!name) return null;

      const startDateRaw = String(row.startDate || '').trim();
      const startDate = DATE_KEY_REGEX.test(startDateRaw) ? startDateRaw : undefined;

      const daysRaw = Number(row.days);
      const manpowerRaw = Number(row.manpower);
      const yardsRaw = Number(row.yards);
      const concreteConfirmedRaw = row.concreteConfirmed;
      const concreteConfirmed = concreteConfirmedRaw === true;

      return {
        name,
        ...(startDate ? { startDate } : {}),
        ...(Number.isFinite(daysRaw) && daysRaw > 0 ? { days: Math.round(daysRaw) } : {}),
        ...(Number.isFinite(manpowerRaw) && manpowerRaw >= 0 ? { manpower: manpowerRaw } : {}),
        ...(Number.isFinite(yardsRaw) && yardsRaw >= 0 ? { yards: yardsRaw } : {}),
        ...(Number.isFinite(yardsRaw) && yardsRaw > 0 ? { concreteConfirmed } : {}),
      };
    })
    .filter((entry): entry is ScopeTaskEntry => Boolean(entry));
}

async function validateSpecificDays(
  entries: SelectedDayEntry[] | null,
  schedulingMode: 'contiguous' | 'specific-days',
  options?: { allowWeekendSelectedDays?: boolean }
) {
  if (schedulingMode !== 'specific-days') return { valid: true as const };

  const allowWeekendSelectedDays = options?.allowWeekendSelectedDays === true;

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
    if (!allowWeekendSelectedDays && (day === 0 || day === 6)) {
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

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const cacheKey = buildSearchParamsCacheKey(`${PROJECT_SCOPES_CACHE_PREFIX}get`, searchParams);
    const cached = getCachedValue<Record<string, unknown>>(cacheKey);
    if (cached) {
      const response = NextResponse.json(cached);
      response.headers.set('Cache-Control', 'private, max-age=30, must-revalidate');
      response.headers.set('X-Cache', 'HIT');
      return response;
    }

    const jobKey = searchParams.get('jobKey');

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
      jobKey
        ? prisma.$queryRaw<ProjectScopeRow[]>`
            SELECT
              id,
              "ganttV2ScopeId",
              "jobKey",
              title,
              "startDate",
              "endDate",
              manpower,
              hours,
              description,
              tasks,
              "schedulingMode",
              "selectedDays",
              color,
              "taskColors"
            FROM "ProjectScope"
            WHERE "jobKey" = ${jobKey}
          `
        : prisma.$queryRaw<ProjectScopeRow[]>`
            SELECT
              id,
              "ganttV2ScopeId",
              "jobKey",
              title,
              "startDate",
              "endDate",
              manpower,
              hours,
              description,
              tasks,
              "schedulingMode",
              "selectedDays",
              color,
              "taskColors"
            FROM "ProjectScope"
          `,
    ]);

    const normalizedScopes = scopes.map((scope) => ({
      ...scope,
      tasks: normalizeScopeTasks(scope.tasks) ?? null,
    }));

    // Add jobKey to each project for consistency
    const projectsWithJobKey = projects.map((p) => ({
      ...p,
      jobKey: `${String(p.customer || '')}~${String(p.projectNumber || '')}~${String(p.projectName || '')}`,
    }));

    const payload = {
      success: true,
      data: normalizedScopes,
      projects: projectsWithJobKey,
      scopes: normalizedScopes, // Keep for backwards compatibility
    };

    setCachedValue(cacheKey, payload, PROJECT_SCOPES_CACHE_TTL_MS);
    const response = NextResponse.json(payload);
    response.headers.set('Cache-Control', 'private, max-age=30, must-revalidate');
    response.headers.set('X-Cache', 'MISS');
    return response;
  } catch (error) {
    console.error('Failed to fetch project scopes:', error);
    if (shouldFallbackToEmptyRead(error)) {
      return NextResponse.json({
        success: true,
        data: [],
        projects: [],
        scopes: [],
      });
    }
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
      color,
      taskColors,
      schedulingMode,
      selectedDays,
      syncToActiveSchedule,
      allowWeekendSelectedDays,
    } = body;

    const normalizedSchedulingMode =
      schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous';

    const normalizedSelectedDays = toSelectedDayEntries(selectedDays) ?? null;
    const normalizedTasks = normalizeScopeTasks(tasks) ?? null;

    if (!jobKey || !title) {
      return NextResponse.json(
        { success: false, error: 'jobKey and title are required' },
        { status: 400 }
      );
    }

    const specificDaysValidation = await validateSpecificDays(normalizedSelectedDays, normalizedSchedulingMode, {
      allowWeekendSelectedDays: allowWeekendSelectedDays === true,
    });
    if (!specificDaysValidation.valid) {
      return NextResponse.json(
        { success: false, error: specificDaysValidation.error },
        { status: 400 }
      );
    }

    const scope = await withDatabaseRetry(() =>
      prisma.projectScope.create({
        data: {
          jobKey,
          title: title.trim() || 'Scope',
          startDate: startDate || null,
          endDate: endDate || null,
          manpower: manpower !== undefined && manpower !== null ? manpower : null,
          hours: hours && hours > 0 ? hours : null,
          description: description || null,
          tasks: toNullableJsonInput(normalizedTasks),
          schedulingMode: normalizedSchedulingMode,
          selectedDays: toNullableJsonInput(normalizedSelectedDays),
          color: normalizeColor(color),
          taskColors: toNullableJsonInput(taskColors ?? null),
        },
      })
    );

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

    invalidateCacheByPrefix(PROJECT_SCOPES_CACHE_PREFIX);
    invalidateCacheByPrefix('gantt-v2:');

    return NextResponse.json({
      success: true,
      data: scope,
    });
  } catch (error) {
    console.error('Failed to create scope:', error);
    return NextResponse.json(
      { success: false, error: `Failed to create scope: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      id,
      jobKey,
      title,
      startDate,
      endDate,
      manpower,
      hours,
      description,
      tasks,
      color,
      taskColors,
      schedulingMode,
      selectedDays,
      syncToActiveSchedule,
      allowWeekendSelectedDays,
    } = body;

    const normalizedSchedulingMode =
      schedulingMode === undefined
        ? undefined
        : (schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous');

    const normalizedSelectedDays =
      selectedDays === undefined
        ? undefined
        : (toSelectedDayEntries(selectedDays) ?? null);
    const normalizedTasks = normalizeScopeTasks(tasks);

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const normalizedTitle = title !== undefined ? (title.trim() || 'Scope') : undefined;
    const normalizedStartDate = startDate !== undefined ? (startDate || null) : undefined;
    const normalizedEndDate = endDate !== undefined ? (endDate || null) : undefined;
    const normalizedManpower = manpower !== undefined ? (manpower !== null ? manpower : null) : undefined;
    const normalizedHours = hours !== undefined ? (hours && hours > 0 ? hours : null) : undefined;

    const existing = await withDatabaseRetry(() =>
      prisma.projectScope.findUnique({
        where: { id },
        select: {
          title: true,
          startDate: true,
          endDate: true,
          manpower: true,
          hours: true,
          schedulingMode: true,
          selectedDays: true,
        },
      })
    );

    if (!existing) {
      const fallbackJobKey = typeof jobKey === 'string' ? jobKey.trim() : '';
      const fallbackTitle = normalizedTitle || '';

      if (!fallbackJobKey || !fallbackTitle) {
        console.error('[PUT] Scope not found and fallback create is missing jobKey/title:', { id, jobKey, title });
        return NextResponse.json(
          { success: false, error: `Scope not found with id: ${id}` },
          { status: 404 }
        );
      }

      const effectiveSchedulingMode = normalizedSchedulingMode ?? 'contiguous';
      const effectiveSelectedDays = normalizedSelectedDays === undefined ? null : normalizedSelectedDays;
      const specificDaysValidation = await validateSpecificDays(effectiveSelectedDays, effectiveSchedulingMode, {
        allowWeekendSelectedDays: allowWeekendSelectedDays === true,
      });

      if (!specificDaysValidation.valid) {
        return NextResponse.json(
          { success: false, error: specificDaysValidation.error },
          { status: 400 }
        );
      }

      const createdScope = await withDatabaseRetry(() =>
        prisma.projectScope.create({
          data: {
            jobKey: fallbackJobKey,
            title: fallbackTitle,
            startDate: normalizedStartDate ?? null,
            endDate: normalizedEndDate ?? null,
            manpower: normalizedManpower ?? null,
            hours: normalizedHours ?? null,
            description: description || null,
            tasks: toNullableJsonInput(normalizedTasks ?? null),
            schedulingMode: effectiveSchedulingMode,
            selectedDays: toNullableJsonInput(effectiveSelectedDays),
            color: normalizeColor(color),
            taskColors: toNullableJsonInput(taskColors ?? null),
          },
        })
      );

      if (syncToActiveSchedule !== false) {
        try {
          const syncResult = await syncProjectScopeToActiveSchedule(createdScope.id);
          console.log(`[project-scopes PUT] Synced fallback-created scope ${createdScope.id} to ActiveSchedule:`, syncResult);
        } catch (syncError) {
          console.error('[project-scopes PUT] Failed to sync fallback-created scope to ActiveSchedule:', syncError);
        }
      }

      invalidateCacheByPrefix(PROJECT_SCOPES_CACHE_PREFIX);
      invalidateCacheByPrefix('gantt-v2:');

      return NextResponse.json({
        success: true,
        data: createdScope,
        createdFromFallback: true,
      });
    }

    const effectiveSchedulingMode = normalizedSchedulingMode ?? (existing?.schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous');
    const effectiveSelectedDays = normalizedSelectedDays === undefined
      ? (Array.isArray(existing?.selectedDays) ? (existing?.selectedDays as SelectedDayEntry[]) : null)
      : normalizedSelectedDays;

    const specificDaysValidation = await validateSpecificDays(effectiveSelectedDays, effectiveSchedulingMode, {
      allowWeekendSelectedDays: allowWeekendSelectedDays === true,
    });
    if (!specificDaysValidation.valid) {
      return NextResponse.json(
        { success: false, error: specificDaysValidation.error },
        { status: 400 }
      );
    }

    const didScheduleAffectingFieldsChange =
      (normalizedTitle !== undefined && normalizedTitle !== (existing?.title || '')) ||
      (normalizedStartDate !== undefined && normalizedStartDate !== (existing?.startDate || null)) ||
      (normalizedEndDate !== undefined && normalizedEndDate !== (existing?.endDate || null)) ||
      (normalizedManpower !== undefined && normalizedManpower !== (existing?.manpower ?? null)) ||
      (normalizedHours !== undefined && normalizedHours !== (existing?.hours ?? null)) ||
      (normalizedSchedulingMode !== undefined && normalizedSchedulingMode !== (existing?.schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous')) ||
      (normalizedSelectedDays !== undefined && JSON.stringify(normalizedSelectedDays) !== JSON.stringify(Array.isArray(existing?.selectedDays) ? existing.selectedDays : null));

    const scope = await withDatabaseRetry(() =>
      prisma.projectScope.update({
        where: { id },
        data: {
          ...(normalizedTitle !== undefined && { title: normalizedTitle }),
          ...(normalizedStartDate !== undefined && { startDate: normalizedStartDate }),
          ...(normalizedEndDate !== undefined && { endDate: normalizedEndDate }),
          ...(normalizedManpower !== undefined && { manpower: normalizedManpower }),
          ...(normalizedHours !== undefined && { hours: normalizedHours }),
          ...(description !== undefined && { description: description || null }),
          ...(tasks !== undefined && { tasks: toNullableJsonInput(normalizedTasks ?? null) }),
          ...(normalizedSchedulingMode !== undefined && { schedulingMode: normalizedSchedulingMode }),
          ...(normalizedSelectedDays !== undefined && { selectedDays: toNullableJsonInput(normalizedSelectedDays) }),
          ...(color !== undefined && { color: normalizeColor(color) }),
          ...(taskColors !== undefined && { taskColors: toNullableJsonInput(taskColors ?? null) }),
        },
      })
    );

    const shouldSync = syncToActiveSchedule !== false;
    if (shouldSync && didScheduleAffectingFieldsChange) {
      // Sync to ActiveSchedule so it appears on long-term schedule
      try {
        const syncResult = await syncProjectScopeToActiveSchedule(id);
        console.log(`[project-scopes PUT] Synced scope ${id} to ActiveSchedule:`, syncResult);
      } catch (syncError) {
        console.error('[project-scopes PUT] Failed to sync to ActiveSchedule:', syncError);
      }
    }

    invalidateCacheByPrefix(PROJECT_SCOPES_CACHE_PREFIX);
    invalidateCacheByPrefix('gantt-v2:');

    return NextResponse.json({
      success: true,
      data: scope,
    });
  } catch (error) {
    console.error('Failed to update scope:', error);
    console.error('Error details:', error instanceof Error ? { message: error.message, stack: error.stack } : error);
    return NextResponse.json(
      { success: false, error: `Failed to update scope: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    const jobKey = request.nextUrl.searchParams.get('jobKey');
    const title = request.nextUrl.searchParams.get('title');
    const normalizedJobKey = String(jobKey || '').trim();
    const normalizedTitle = String(title || '').trim();

    if (!id && !(normalizedJobKey && normalizedTitle)) {
      return NextResponse.json(
        { success: false, error: 'id is required, or provide both jobKey and title' },
        { status: 400 }
      );
    }

    // Clean up ActiveSchedule entries before deleting (only applicable when scope id is known)
    if (id) {
      await deleteProjectScopeFromActiveSchedule(id);
    } else {
      await prisma.activeSchedule.deleteMany({
        where: {
          jobKey: normalizedJobKey,
          scopeOfWork: {
            equals: normalizedTitle,
            mode: 'insensitive',
          },
        },
      });
    }

    const deleted = await prisma.projectScope.deleteMany({
      where: id
        ? { id }
        : {
            jobKey: normalizedJobKey,
            title: {
              equals: normalizedTitle,
              mode: 'insensitive',
            },
          },
    });

    invalidateCacheByPrefix(PROJECT_SCOPES_CACHE_PREFIX);
    invalidateCacheByPrefix('gantt-v2:');

    return NextResponse.json({ success: true, deletedCount: deleted.count });
  } catch (error) {
    console.error('Failed to delete scope:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete scope' }, { status: 500 });
  }
}

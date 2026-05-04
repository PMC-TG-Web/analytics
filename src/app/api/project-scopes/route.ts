import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { syncProjectScopeToActiveSchedule, deleteProjectScopeFromActiveSchedule } from '@/utils/syncActiveSchedule';
import { getErrorMessage, withDatabaseRetry } from '@/lib/dbResilience';

export const dynamic = 'force-dynamic';

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

const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
let ensureProjectScopeColumnsPromise: Promise<void> | null = null;

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
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

      const row = entry as Record<string, unknown>;
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

async function ensureProjectScopeColumns() {
  if (!ensureProjectScopeColumnsPromise) {
    ensureProjectScopeColumnsPromise = (async () => {
      try {
        await prisma.$executeRawUnsafe(`
          ALTER TABLE "ProjectScope"
            ADD COLUMN IF NOT EXISTS "schedulingMode" TEXT NOT NULL DEFAULT 'contiguous',
            ADD COLUMN IF NOT EXISTS "selectedDays" JSONB,
            ADD COLUMN IF NOT EXISTS "color" VARCHAR(7),
            ADD COLUMN IF NOT EXISTS "taskColors" JSONB
        `);
      } catch (error) {
        // Production DBs may disallow DDL from the app role. Continue with fallback selects.
        console.warn('ensureProjectScopeColumns skipped:', error);
      }
    })();
  }

  await ensureProjectScopeColumnsPromise;
}

export async function GET(request: NextRequest) {
  try {
    await ensureProjectScopeColumns();
    const searchParams = request.nextUrl.searchParams;
    const jobKey = searchParams.get('jobKey');

    let projects: Array<Record<string, unknown>> = [];
    let scopes: Array<Record<string, unknown>> = [];

    try {
      // Preferred path with newer columns.
      [projects, scopes] = await Promise.all([
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
        }) as unknown as Promise<Array<Record<string, unknown>>>,
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
        }) as unknown as Promise<Array<Record<string, unknown>>>,
      ]);
    } catch (schemaError) {
      console.warn('Falling back to legacy project/projectScope selects:', schemaError);
      [projects, scopes] = await Promise.all([
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
            cost: true,
            dateCreated: true,
            dateUpdated: true,
            estimator: true,
            projectManager: true,
            customFields: true,
          },
        }) as unknown as Promise<Array<Record<string, unknown>>>,
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
        }) as unknown as Promise<Array<Record<string, unknown>>>,
      ]);
    }

    // Fetch color and taskColors using raw SQL since they may not be in Prisma schema yet
    let scopesWithColors = scopes;
    try {
      const scopeIds = scopes.map((s) => String(s.id || ''));
      if (scopeIds.length > 0) {
        console.log(`[GET] Fetching colors for ${scopeIds.length} scopes`);
        
        const colorData = await prisma.$queryRawUnsafe<Array<{ id: string; color: string | null; taskColors: any }>>(
          `SELECT id, "color", "taskColors" FROM "ProjectScope" WHERE id = ANY($1)`,
          scopeIds
        );
        
        console.log(`[GET] Retrieved color data:`, colorData);
        
        const colorMap = new Map(colorData.map(d => [d.id, { color: d.color, taskColors: d.taskColors }]));
        
        scopesWithColors = scopes.map(scope => ({
          ...scope,
          color: colorMap.get(String(scope.id || ''))?.color || null,
          taskColors: colorMap.get(String(scope.id || ''))?.taskColors || null,
        }));
      }
    } catch (colorError) {
      console.warn('Failed to fetch colors for scopes:', colorError);
      // Continue without colors if query fails
    }

    const normalizedScopes = scopesWithColors.map((scope) => ({
      ...scope,
      tasks: normalizeScopeTasks(scope.tasks) ?? null,
    }));

    // Add jobKey to each project for consistency
    const projectsWithJobKey = projects.map((p) => ({
      ...p,
      jobKey: `${String(p.customer || '')}~${String(p.projectNumber || '')}~${String(p.projectName || '')}`,
    }));

    return NextResponse.json({
      success: true,
      data: normalizedScopes,
      projects: projectsWithJobKey,
      scopes: normalizedScopes, // Keep for backwards compatibility
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
          tasks: normalizedTasks,
          schedulingMode: normalizedSchedulingMode,
          selectedDays: normalizedSelectedDays,
        } as any,
      })
    );

    // Update color and taskColors with raw SQL - handle them separately for clarity
    try {
      const colorValue = color || null;
      const taskColorsValue = taskColors ? JSON.stringify(taskColors) : null;
      
      console.log(`[POST] Updating colors for new scope ${scope.id}:`, { colorValue, taskColorsValue });
      
      await prisma.$executeRawUnsafe(
        `UPDATE "ProjectScope" SET "color" = $1, "taskColors" = $2::jsonb WHERE id = $3`,
        colorValue,
        taskColorsValue,
        scope.id
      );
      
      console.log(`[POST] Color update successful for scope ${scope.id}`);
    } catch (colorError) {
      console.error('Failed to update scope colors on POST:', colorError);
      // Don't fail the whole request if color save fails
    }

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
      { success: false, error: `Failed to create scope: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('[PUT] Request body:', JSON.stringify(body, null, 2));
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
    console.log('[PUT] Parsed fields:', { id, title, schedulingMode, selectedDays, allowWeekendSelectedDays });

    const normalizedSchedulingMode =
      schedulingMode === undefined
        ? undefined
        : (schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous');

    const normalizedSelectedDays =
      selectedDays === undefined
        ? undefined
        : (toSelectedDayEntries(selectedDays) ?? null);
    console.log('[PUT] Normalized selectedDays:', normalizedSelectedDays);
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
            tasks: normalizedTasks ?? null,
            schedulingMode: effectiveSchedulingMode,
            selectedDays: effectiveSelectedDays,
          } as any,
        })
      );

      return NextResponse.json({
        success: true,
        data: createdScope,
        createdFromFallback: true,
      });
    }
    console.log('[PUT] Found existing scope:', { id, title: existing.title });

    const effectiveSchedulingMode = normalizedSchedulingMode ?? (existing?.schedulingMode === 'specific-days' ? 'specific-days' : 'contiguous');
    const effectiveSelectedDays = normalizedSelectedDays === undefined
      ? (Array.isArray(existing?.selectedDays) ? (existing?.selectedDays as SelectedDayEntry[]) : null)
      : normalizedSelectedDays;
    console.log('[PUT] Validation check:', { effectiveSchedulingMode, effectiveSelectedDays });

    const specificDaysValidation = await validateSpecificDays(effectiveSelectedDays, effectiveSchedulingMode, {
      allowWeekendSelectedDays: allowWeekendSelectedDays === true,
    });
    console.log('[PUT] Validation result:', specificDaysValidation);
    if (!specificDaysValidation.valid) {
      console.error('[PUT] Validation failed:', specificDaysValidation.error);
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

    console.log('[PUT] About to update scope with:', {
      id,
      normalizedTitle,
      normalizedStartDate,
      normalizedEndDate,
      normalizedManpower,
      normalizedHours,
      description,
      tasks: normalizedTasks,
      normalizedSchedulingMode,
      normalizedSelectedDays,
    });

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
          ...(tasks !== undefined && { tasks: normalizedTasks ?? null }),
          ...(normalizedSchedulingMode !== undefined && { schedulingMode: normalizedSchedulingMode }),
          ...(normalizedSelectedDays !== undefined && { selectedDays: normalizedSelectedDays }),
        } as any,
      })
    );
    console.log('[PUT] Update successful, scope:', scope);

    // Update color and taskColors with raw SQL
    if (color !== undefined || taskColors !== undefined) {
      try {
        const colorValue = color !== undefined ? (color || null) : undefined;
        const taskColorsValue = taskColors !== undefined ? (taskColors ? JSON.stringify(taskColors) : null) : undefined;
        
        console.log(`[PUT] Received color update for scope ${id}:`, { color, colorValue, taskColors, taskColorsValue });
        
        const updates = [];
        const params: any[] = [];
        
        if (color !== undefined) {
          params.push(colorValue);
          updates.push(`"color" = $${params.length}`);
        }
        
        if (taskColors !== undefined) {
          params.push(taskColorsValue);
          updates.push(`"taskColors" = $${params.length}::jsonb`);
        }
        
        if (updates.length > 0) {
          params.push(id);
          const query = `UPDATE "ProjectScope" SET ${updates.join(', ')} WHERE id = $${params.length}`;
          console.log(`[PUT] Executing query:`, query);
          console.log(`[PUT] With params:`, params);
          
          await prisma.$executeRawUnsafe(query, ...params);
          
          console.log(`[PUT] Color update successful for scope ${id}`);
        }
      } catch (colorError) {
        console.error('Failed to update scope colors on PUT:', colorError);
        // Don't fail the whole request if color save fails
      }
    }

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

    if (!id && !(jobKey && title)) {
      return NextResponse.json(
        { success: false, error: 'id is required, or provide both jobKey and title' },
        { status: 400 }
      );
    }

    // Clean up ActiveSchedule entries before deleting (only applicable when scope id is known)
    if (id) {
      await deleteProjectScopeFromActiveSchedule(id);
    }

    const deleted = await prisma.projectScope.deleteMany({
      where: id
        ? { id }
        : {
            jobKey: String(jobKey || ''),
            title: String(title || ''),
          },
    });

    return NextResponse.json({ success: true, deletedCount: deleted.count });
  } catch (error) {
    console.error('Failed to delete scope:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete scope' }, { status: 500 });
  }
}

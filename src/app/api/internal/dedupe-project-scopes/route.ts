import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Duplicate cleanup endpoint for ProjectScope rows.
// Protected by CRON_SECRET. Supports dry-run by default.
// Call with Authorization: Bearer $CRON_SECRET

type ScopeRow = {
  id: string;
  jobKey: string;
  title: string;
  ganttV2ScopeId: string | null;
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
  updatedAt: Date | string;
};

function isNonEmptyJsonArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

function safeJsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pickPreferredScope(scopes: ScopeRow[]): ScopeRow {
  const linked = scopes.find((scope) => Boolean(scope.ganttV2ScopeId));
  if (linked) return linked;

  const withTasks = scopes.find((scope) => isNonEmptyJsonArray(scope.tasks));
  if (withTasks) return withTasks;

  return scopes.slice().sort((left, right) => {
    const leftTime = new Date(left.updatedAt).getTime();
    const rightTime = new Date(right.updatedAt).getTime();
    return rightTime - leftTime;
  })[0];
}

function mergeScopeData(primary: ScopeRow, scopes: ScopeRow[]) {
  const mergedTasks = scopes.flatMap((scope) => safeJsonArray(scope.tasks));
  const mergedSelectedDays = scopes.flatMap((scope) => safeJsonArray(scope.selectedDays));

  const firstNonNull = <T,>(values: Array<T | null | undefined>): T | null => {
    for (const value of values) {
      if (value !== null && value !== undefined && value !== '') return value;
    }
    return null;
  };

  return {
    title: firstNonNull(scopes.map((scope) => scope.title)) ?? primary.title,
    startDate: firstNonNull(scopes.map((scope) => scope.startDate)) ?? primary.startDate,
    endDate: firstNonNull(scopes.map((scope) => scope.endDate)) ?? primary.endDate,
    manpower: firstNonNull(scopes.map((scope) => scope.manpower)) ?? primary.manpower,
    hours: firstNonNull(scopes.map((scope) => scope.hours)) ?? primary.hours,
    description: firstNonNull(scopes.map((scope) => scope.description)) ?? primary.description,
    schedulingMode: firstNonNull(scopes.map((scope) => scope.schedulingMode)) ?? primary.schedulingMode,
    color: firstNonNull(scopes.map((scope) => scope.color)) ?? primary.color,
    tasks: mergedTasks,
    selectedDays: mergedSelectedDays,
    taskColors: firstNonNull(scopes.map((scope) => scope.taskColors)) ?? primary.taskColors,
  };
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  const secret = process.env.CRON_SECRET;
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun = body?.dryRun !== false;

  try {
    const duplicateGroups = await prisma.$queryRaw<
      { jobKey: string; title: string; cnt: bigint }[]
    >`
      SELECT "jobKey", title, COUNT(*) as cnt
      FROM "ProjectScope"
      GROUP BY "jobKey", title
      HAVING COUNT(*) > 1
      ORDER BY cnt DESC, "jobKey", title
    `;

    const groups: Array<{
      jobKey: string;
      title: string;
      count: number;
      canonicalId: string;
      duplicateIds: string[];
      mergedPreview: Record<string, unknown>;
    }> = [];

    let deleted = 0;
    let merged = 0;

    for (const group of duplicateGroups) {
      const scopes = await prisma.$queryRaw<ScopeRow[]>`
        SELECT id, "jobKey", title, "ganttV2ScopeId", "startDate", "endDate",
               manpower, hours, description, tasks, "schedulingMode", "selectedDays",
               color, "taskColors", "updatedAt"
        FROM "ProjectScope"
        WHERE "jobKey" = ${group.jobKey}
          AND title = ${group.title}
        ORDER BY CASE WHEN "ganttV2ScopeId" IS NOT NULL THEN 0 ELSE 1 END,
                 CASE WHEN tasks IS NOT NULL AND tasks::text != 'null' AND jsonb_typeof(tasks) = 'array' AND jsonb_array_length(tasks) > 0 THEN 0 ELSE 1 END,
                 "updatedAt" DESC
      `;

      if (scopes.length < 2) continue;

      const canonical = pickPreferredScope(scopes);
      const duplicates = scopes.filter((scope) => scope.id !== canonical.id);
      const mergedData = mergeScopeData(canonical, scopes);

      groups.push({
        jobKey: group.jobKey,
        title: group.title,
        count: Number(group.cnt),
        canonicalId: canonical.id,
        duplicateIds: duplicates.map((scope) => scope.id),
        mergedPreview: mergedData,
      });

      if (dryRun) continue;

      await prisma.$executeRaw`
        UPDATE "ProjectScope"
        SET title = ${mergedData.title},
            "startDate" = ${mergedData.startDate},
            "endDate" = ${mergedData.endDate},
            manpower = ${mergedData.manpower},
            hours = ${mergedData.hours},
            description = ${mergedData.description},
            tasks = ${mergedData.tasks as unknown as object},
            "schedulingMode" = ${mergedData.schedulingMode},
            "selectedDays" = ${mergedData.selectedDays as unknown as object},
            color = ${mergedData.color},
            "taskColors" = ${mergedData.taskColors as unknown as object},
            "updatedAt" = NOW()
        WHERE id = ${canonical.id}
      `;

      const duplicateIds = duplicates.map((scope) => scope.id);
      if (duplicateIds.length > 0) {
        await prisma.$executeRaw`
          DELETE FROM "ProjectScope"
          WHERE id = ANY(${duplicateIds}::text[])
        `;
        deleted += duplicateIds.length;
      }

      merged++;
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      duplicateGroups: groups.length,
      merged,
      deleted,
      groups,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Duplicate scope cleanup failed:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
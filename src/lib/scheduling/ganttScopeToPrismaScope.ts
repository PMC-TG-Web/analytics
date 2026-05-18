/**
 * Helper to mirror a GanttV2Scope write into the unified ProjectScope table.
 *
 * This is the dual-write bridge used during Phase 2 of the scope consolidation.
 * Once all existing GanttV2Scope rows are backfilled (Phase 3) and reads are
 * switched to ProjectScope (Phase 4), the GanttV2Scope writes will be removed
 * and this file can be deleted.
 *
 * Key design decisions:
 * - `ganttV2ScopeId` (unique) is the primary link key.
 * - Falls back to `jobKey + title` to update rows that existed before Phase 2
 *   (i.e., before ganttV2ScopeId was populated via the backfill).
 * - Only sets `schedulingMode`, `selectedDays`, `tasks` from defaults if the row
 *   is being created; a pre-existing ProjectScope keeps its scheduling params.
 */

import { prisma } from '@/lib/prisma';

type GanttProject = {
  customer: string | null;
  project_number: string | null;
  project_name: string;
};

/** Resolves the jobKey for a GanttV2 project from the database. */
async function resolveJobKey(projectId: string): Promise<string | null> {
  const rows = await prisma.$queryRawUnsafe<GanttProject[]>(
    `SELECT customer, project_number, project_name FROM gantt_v2_projects WHERE id = $1 LIMIT 1`,
    projectId
  );
  if (!rows || rows.length === 0) return null;
  const { customer, project_number, project_name } = rows[0];
  return `${customer || ''}~${project_number || ''}~${project_name || ''}`;
}

type UpsertGanttScopeToProjectScopeParams = {
  ganttV2ScopeId: string;
  projectId: string;
  title: string;
  startDate: string | null;
  endDate: string | null;
  totalHours: number;
  crewSize: number | null;
  notes: string | null;
  predecessorScopeId: string | null;
};

/**
 * Upsert a ProjectScope row to mirror the given GanttV2Scope.
 * Preserves existing schedulingMode / selectedDays / tasks if the row already exists.
 */
export async function upsertGanttScopeToProjectScope(
  params: UpsertGanttScopeToProjectScopeParams
): Promise<void> {
  const {
    ganttV2ScopeId,
    projectId,
    title,
    startDate,
    endDate,
    totalHours,
    crewSize,
    notes,
    predecessorScopeId,
  } = params;

  const jobKey = await resolveJobKey(projectId);
  if (!jobKey) {
    console.warn('[ganttScopeToPrismaScope] Could not resolve jobKey for projectId', projectId);
    return;
  }

  // Shared fields that always get written
  const sharedData = {
    jobKey,
    title,
    startDate: startDate ?? undefined,
    endDate: endDate ?? undefined,
    hours: totalHours,
    manpower: crewSize,
    notes: notes ?? undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    predecessorScopeId: predecessorScopeId ?? undefined as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ganttV2ScopeId: ganttV2ScopeId as any,
  };

  // 1. Try to find by ganttV2ScopeId (the canonical link key)
  const byGanttId = await prisma.projectScope.findFirst({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    where: { ganttV2ScopeId: ganttV2ScopeId } as any,
    select: { id: true },
  });

  if (byGanttId) {
    await prisma.projectScope.update({
      where: { id: byGanttId.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: sharedData as any,
    });
    return;
  }

  // 2. Fall back to jobKey+title (handles rows created before the backfill)
  const byJobKeyTitle = await prisma.projectScope.findFirst({
    where: { jobKey, title },
    select: { id: true },
  });

  if (byJobKeyTitle) {
    await prisma.projectScope.update({
      where: { id: byJobKeyTitle.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: sharedData as any,
    });
    return;
  }

  // 3. Neither exists — create a new row with safe defaults
  await prisma.projectScope.create({
    data: {
      jobKey,
      title,
      startDate: startDate ?? undefined,
      endDate: endDate ?? undefined,
      hours: totalHours,
      manpower: crewSize,
      notes: notes ?? undefined,
      schedulingMode: 'contiguous',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      predecessorScopeId: predecessorScopeId ?? undefined as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ganttV2ScopeId: ganttV2ScopeId as any,
    } as any,
  });
}

/**
 * Delete the ProjectScope row that was mirroring the given GanttV2Scope.
 * Only deletes rows that were created by the dual-write bridge (i.e. have ganttV2ScopeId set).
 */
export async function deleteGanttScopeFromProjectScope(ganttV2ScopeId: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM "ProjectScope" WHERE "ganttV2ScopeId" = $1`,
    ganttV2ScopeId
  );
}

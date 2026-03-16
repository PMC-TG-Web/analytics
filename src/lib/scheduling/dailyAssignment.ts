import { prisma } from "@/lib/prisma";

export type DailyAssignmentCommand = {
  jobKey: string;
  scopeOfWork: string;
  targetDateKey: string;
  targetForemanId: string | null;
  hours: number;
  sourceDateKey?: string | null;
  fallbackSource?: string;
  enforceScopeHourCap?: boolean;
};

export type DailyAssignmentResult = {
  sourceType: string;
  deletedOldEntryCount: number;
  targetId: string;
};

export class SchedulingConflictError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(message: string, code: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "SchedulingConflictError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeScopeOfWork(value: string): string {
  return value.trim();
}

export function normalizeForemanId(value: string | null | undefined): string | null {
  if (!value || value === "__unassigned__") return null;
  return value;
}

function normalizeHours(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 8;
  return value;
}

export async function reconcileDailyAssignment(command: DailyAssignmentCommand): Promise<DailyAssignmentResult> {
  const jobKey = command.jobKey;
  const scopeOfWork = normalizeScopeOfWork(command.scopeOfWork);
  const targetDateKey = command.targetDateKey;
  const sourceDateKey = command.sourceDateKey || null;
  const targetForemanId = normalizeForemanId(command.targetForemanId);
  const hours = normalizeHours(command.hours);
  const fallbackSource = command.fallbackSource || "wip-page";
  const enforceScopeHourCap = command.enforceScopeHourCap === true;

  if (!jobKey || !scopeOfWork || !targetDateKey) {
    throw new Error("jobKey, scopeOfWork, and targetDateKey are required");
  }

  return prisma.$transaction(async (tx) => {
    let sourceType = fallbackSource;

    if (sourceDateKey) {
      const existingEntry = await tx.activeSchedule.findFirst({
        where: {
          jobKey,
          scopeOfWork,
          date: sourceDateKey,
        },
        select: { source: true },
      });

      if (existingEntry?.source) {
        sourceType = existingEntry.source;
      }
    }

    let deletedOldEntryCount = 0;
    if (sourceDateKey && sourceDateKey !== targetDateKey) {
      const deleteResult = await tx.activeSchedule.deleteMany({
        where: {
          jobKey,
          scopeOfWork,
          date: sourceDateKey,
        },
      });
      deletedOldEntryCount = deleteResult.count;
    }

    if (enforceScopeHourCap) {
      const scope = await tx.projectScope.findFirst({
        where: {
          jobKey,
          title: scopeOfWork,
        },
        select: {
          hours: true,
        },
      });

      const scopeHourCap = scope?.hours ?? null;
      if (scopeHourCap !== null && scopeHourCap >= 0) {
        const existingTargetEntry = await tx.activeSchedule.findUnique({
          where: {
            jobKey_scopeOfWork_date: {
              jobKey,
              scopeOfWork,
              date: targetDateKey,
            },
          },
          select: {
            hours: true,
          },
        });

        const currentScopeAggregate = await tx.activeSchedule.aggregate({
          where: {
            jobKey,
            scopeOfWork,
          },
          _sum: {
            hours: true,
          },
        });

        const existingTotal = currentScopeAggregate._sum.hours ?? 0;
        const existingTargetHours = existingTargetEntry?.hours ?? 0;
        const projectedTotal = existingTotal - existingTargetHours + hours;

        if (projectedTotal > scopeHourCap + 1e-9) {
          throw new SchedulingConflictError(
            `Scope hours exceeded for '${scopeOfWork}'.`,
            "SCOPE_HOURS_EXCEEDED",
            {
              jobKey,
              scopeOfWork,
              scopeHourCap,
              existingTotal,
              existingTargetHours,
              attemptedHours: hours,
              projectedTotal,
              targetDateKey,
            }
          );
        }
      }
    }

    const upsertResult = await tx.activeSchedule.upsert({
      where: {
        jobKey_scopeOfWork_date: {
          jobKey,
          scopeOfWork,
          date: targetDateKey,
        },
      },
      create: {
        jobKey,
        scopeOfWork,
        date: targetDateKey,
        hours,
        foreman: targetForemanId,
        source: sourceType,
      },
      update: {
        hours,
        foreman: targetForemanId,
        source: sourceType,
      },
      select: {
        id: true,
      },
    });

    return {
      sourceType,
      deletedOldEntryCount,
      targetId: upsertResult.id,
    };
  });
}

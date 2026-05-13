import { prisma } from './prisma';

type SyncStep = {
  name: string;
  path: string;
  body: Record<string, unknown>;
};

type StepResult = {
  step: string;
  status: 'ok' | 'error';
  httpStatus: number;
  detail?: unknown;
};

export type CronSyncResult = {
  success: boolean;
  accepted: boolean;
  companyId: string;
  logId: string | null;
  steps: StepResult[];
  mvResults: Record<string, string>;
  syncWindow: {
    startDate: string;
    endDate: string;
    lookbackDays: number;
    maxProjects: number;
  };
  totalMs: number;
};

const MATERIALIZED_VIEWS = [
  'bid_board_latest_mv',
  'budget_agg_mv',
  'commitments_agg_mv',
];

function toDateKey(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function getRequiredSyncSecret(): string {
  return (process.env.PROCORE_SYNC_SECRET || process.env.SYNC_SECRET || '').trim();
}

export function buildSyncWindow(options?: {
  now?: number;
  lookbackDays?: number;
  maxProjects?: number;
}) {
  const now = options?.now ?? Date.now();
  const lookbackDays = Math.min(
    120,
    Math.max(
      7,
      options?.lookbackDays ?? parsePositiveInt(process.env.PROCORE_SYNC_LOOKBACK_DAYS, 30)
    )
  );
  const maxProjects = Math.max(
    0,
    options?.maxProjects ?? parsePositiveInt(process.env.PROCORE_SYNC_MAX_PROJECTS, 25)
  );
  const endDate = toDateKey(new Date(now));
  const startDate = toDateKey(new Date(now - lookbackDays * 24 * 60 * 60 * 1000));

  return { startDate, endDate, lookbackDays, maxProjects };
}

function buildSyncSteps(options: { startDate: string; endDate: string; maxProjects: number }): SyncStep[] {
  const { startDate, endDate, maxProjects } = options;
  return [
    {
      name: 'projects',
      path: '/api/procore/sync/all-projects',
      body: {
        fetchAll: true,
        forceUserOAuth: false,
        maxPages: maxProjects > 0 ? Math.max(1, Math.ceil(maxProjects / 100)) : 200,
        includeInactiveV1: false,
        includeTestProjects: false,
      },
    },
    {
      name: 'bids',
      path: '/api/procore/sync/bids',
      body: {
        companyWide: true,
        fetchAll: true,
        forceUserOAuth: false,
        limitProjects: maxProjects > 0 ? maxProjects : 1000,
      },
    },
    {
      name: 'budget-line-items',
      path: '/api/procore/sync/budget-line-items',
      body: {
        forceUserOAuth: false,
        fetchAll: true,
        ...(maxProjects > 0 ? { limitProjects: maxProjects } : {}),
      },
    },
    {
      name: 'commitment-contracts',
      path: '/api/procore/sync/commitment-contracts',
      body: {
        forceUserOAuth: false,
        fetchAll: true,
        ...(maxProjects > 0 ? { maxProjects } : {}),
      },
    },
    {
      name: 'timecard-entries',
      path: '/api/procore/sync/timecard-entries',
      body: {
        forceUserOAuth: false,
        startDate,
        endDate,
        perPage: 50,
        concurrency: 1,
        ...(maxProjects > 0 ? { maxProjects } : {}),
      },
    },
    {
      name: 'productivity-logs',
      path: '/api/procore/sync/productivity-projects',
      body: {
        forceUserOAuth: false,
        persist: true,
        startDate,
        endDate,
        perPage: 50,
        concurrency: 1,
        ...(maxProjects > 0 ? { maxProjects } : {}),
      },
    },
  ];
}

async function readResponseDetail(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json().catch(() => null);
  }

  return response.text().catch(() => null);
}

async function runSyncStep(options: {
  origin: string;
  companyId: string;
  syncSecret: string;
  step: SyncStep;
}): Promise<StepResult> {
  const { origin, companyId, syncSecret, step } = options;

  try {
    const response = await fetch(`${origin}${step.path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-sync-secret': syncSecret,
      },
      body: JSON.stringify({ ...step.body, companyId }),
    });

    return {
      step: step.name,
      status: response.ok ? 'ok' : 'error',
      httpStatus: response.status,
      ...(response.ok ? {} : { detail: await readResponseDetail(response) }),
    };
  } catch (error) {
    return {
      step: step.name,
      status: 'error',
      httpStatus: 0,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function refreshMaterializedViews(): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  for (const view of MATERIALIZED_VIEWS) {
    try {
      await prisma.$executeRawUnsafe(
        `REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`
      );
      results[view] = 'refreshed';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('does not exist') || msg.includes('undefined_table')) {
        results[view] = 'skipped (view not found)';
      } else {
        results[view] = `error: ${msg}`;
      }
    }
  }
  return results;
}

export async function runProcoreCronSync(options: {
  origin: string;
  companyId: string;
  syncSecret: string;
  triggeredBy: string;
  maxProjects?: number;
  lookbackDays?: number;
}): Promise<CronSyncResult> {
  const origin = options.origin.replace(/\/$/, '');
  const startTime = Date.now();
  const syncWindow = buildSyncWindow({
    now: startTime,
    lookbackDays: options.lookbackDays,
    maxProjects: options.maxProjects,
  });
  const syncSteps = buildSyncSteps(syncWindow);
  let logId: bigint | null = null;

  try {
    const log = await prisma.syncLog.create({
      data: {
        companyId: options.companyId,
        triggeredBy: options.triggeredBy,
        steps: syncSteps.map((step) => ({ step: step.name, status: 'pending' })),
      },
      select: { id: true },
    });
    logId = log.id;
  } catch (error) {
    console.error('[cron/sync] Failed to create log entry:', error);
  }

  const steps: StepResult[] = [];
  for (const step of syncSteps) {
    steps.push(await runSyncStep({
      origin,
      companyId: options.companyId,
      syncSecret: options.syncSecret,
      step,
    }));
  }
  const mvResults = await refreshMaterializedViews().catch((error) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
  const totalMs = Date.now() - startTime;
  const success = steps.every((step) => step.status === 'ok');

  if (logId !== null) {
    await prisma.syncLog.update({
      where: { id: logId },
      data: {
        finishedAt: new Date(),
        success,
        totalMs,
        steps: steps as object[],
        mvResults: mvResults as object,
      },
    }).catch((error) => {
      console.error('[cron/sync] Failed to update log entry:', error);
    });
  }

  return {
    success,
    accepted: true,
    companyId: options.companyId,
    logId: logId?.toString() ?? null,
    steps,
    mvResults,
    syncWindow,
    totalMs,
  };
}

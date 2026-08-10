import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequiredSyncSecret } from "@/lib/cronSync";
import {
  acquireProcoreWorker,
  claimDueProject,
  finishProjectSync,
  getSyncQueueStats,
  releaseProcoreWorker,
  seedAllProjectSyncQueue,
  setProcoreRateLimit,
  type QueuedProject,
} from "@/lib/procoreSyncQueue";
import { procoreLookbackWindow } from "@/lib/procoreDateWindow";
import {
  procoreSyncDetailHasErrors,
  procoreSyncResponseIsRateLimited,
} from "@/lib/procoreSyncResponse";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type StepResult = {
  step: string;
  status: "ok" | "error";
  httpStatus: number;
  rateLimited?: boolean;
  rateLimitUntil?: string;
  detail?: unknown;
};

const ACTUALS_DATASET = "actuals";
const RECONCILIATION_DATASET = "actuals_reconciliation";
const SINGLE_ALLOWED_PROCORE_COMPANY_ID =
  (process.env.PROCORE_COMPANY_ID || "598134325805519").trim();

function requestSecret(request: NextRequest) {
  const direct = request.headers.get("x-sync-secret")?.trim()
    || request.headers.get("x-cron-secret")?.trim();
  if (direct) return direct;
  const auth = request.headers.get("authorization")?.trim() || "";
  return auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || auth;
}

function hasValidSecret(request: NextRequest) {
  const provided = requestSecret(request);
  const syncSecret = getRequiredSyncSecret();
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return Boolean(provided) && (provided === syncSecret || (!!cronSecret && provided === cronSecret));
}

function parseProjectIds(value: unknown) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return values.map((item) => String(item || "").trim()).filter(Boolean);
}

function dateWindow(body: Record<string, unknown>, reconciliation: boolean) {
  const valid = (value: unknown) => {
    const text = String(value || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
  };
  const explicitStart = valid(body.startDate || body.start_date);
  const explicitEnd = valid(body.endDate || body.end_date);
  const lookbackDays = Math.min(
    reconciliation ? 730 : 120,
    Math.max(1, Number(
      body.lookbackDays
        || (reconciliation ? process.env.PROCORE_RECONCILIATION_LOOKBACK_DAYS || 400 : process.env.PROCORE_ACTUALS_SYNC_LOOKBACK_DAYS || 45)
    ) || (reconciliation ? 400 : 45))
  );
  const window = procoreLookbackWindow(new Date(), lookbackDays);
  return {
    startDate: explicitStart || window.startDate,
    endDate: explicitEnd || window.endDate,
  };
}

function boundedNumber(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
}

async function pollingCadence(companyId: string, projectId: string, reconciliation: boolean) {
  if (reconciliation) {
    return { class: "weekly-reconciliation", nextRunMinutes: 7 * 24 * 60, latestActivity: null, projectStatus: null };
  }
  const rows = await prisma.$queryRawUnsafe<Array<{
    latest_activity: Date | null;
    project_status: string | null;
  }>>(
    `
      SELECT
        (
          SELECT MAX(activity_date)
          FROM (
            SELECT MAX(date) AS activity_date
            FROM "TimecardEntry"
            WHERE "procoreProjectId" = $2
              AND ("procoreCompanyId" = $1 OR "procoreCompanyId" IS NULL)
              AND "procoreDeletedAt" IS NULL
            UNION ALL
            SELECT MAX(date) AS activity_date
            FROM "ProductivityLog"
            WHERE "procoreProjectId" = $2
              AND ("procoreCompanyId" = $1 OR "procoreCompanyId" IS NULL)
              AND "procoreDeletedAt" IS NULL
          ) activity
        ) AS latest_activity,
        (
          SELECT COALESCE(NULLIF(BTRIM(bid_board_status), ''), NULLIF(BTRIM(status), ''))
          FROM pmc_projects
          WHERE company_id = $1
            AND procore_project_id = $2
          LIMIT 1
        ) AS project_status
    `,
    companyId,
    projectId
  );
  const row = rows[0] || { latest_activity: null, project_status: null };
  const activeDays = boundedNumber(process.env.PROCORE_ACTUALS_ACTIVE_DAYS, 14, 1, 120);
  const activeInterval = boundedNumber(process.env.PROCORE_ACTUALS_ACTIVE_INTERVAL_MINUTES, 90, 15, 24 * 60);
  const idleInterval = boundedNumber(process.env.PROCORE_ACTUALS_IDLE_INTERVAL_MINUTES, 24 * 60, 60, 7 * 24 * 60);
  const status = String(row.project_status || "").trim().toLowerCase();
  const recentThreshold = Date.now() - activeDays * 86_400_000;
  const recentlyActive = Boolean(row.latest_activity && row.latest_activity.getTime() >= recentThreshold);
  const activeStatus = status === "in progress" || status === "active" || status === "course of construction";
  const active = recentlyActive || activeStatus;
  return {
    class: active ? "active" : "idle",
    nextRunMinutes: active ? activeInterval : idleInterval,
    latestActivity: row.latest_activity?.toISOString() || null,
    projectStatus: row.project_status,
  };
}

async function responseDetail(response: Response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return text; }
}

function rateLimitReset(response: Response) {
  const reset = Number(response.headers.get("x-rate-limit-reset") || 0);
  const retryAfter = Number(response.headers.get("retry-after") || 0);
  const fallback = Date.now() + 15 * 60_000;
  const timestamp = Math.max(
    fallback,
    reset > 0 ? reset * 1_000 + 3_000 : 0,
    retryAfter > 0 ? Date.now() + retryAfter * 1_000 + 2_000 : 0
  );
  return new Date(timestamp);
}

async function runStep(params: {
  origin: string;
  syncSecret: string;
  path: string;
  step: string;
  body: Record<string, unknown>;
}): Promise<StepResult> {
  try {
    const response = await fetch(`${params.origin}${params.path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-secret": params.syncSecret },
      body: JSON.stringify(params.body),
      signal: AbortSignal.timeout(4 * 60_000),
    });
    const detail = await responseDetail(response);
    const rateLimited = procoreSyncResponseIsRateLimited(response.status, detail);
    const ok = response.ok && !procoreSyncDetailHasErrors(detail) && !rateLimited;
    const until = rateLimited ? rateLimitReset(response) : null;
    return {
      step: params.step,
      status: ok ? "ok" : "error",
      httpStatus: response.status,
      rateLimited,
      rateLimitUntil: until?.toISOString(),
      detail,
    };
  } catch (error) {
    return {
      step: params.step,
      status: "error",
      httpStatus: 0,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function ensureExplicitProject(companyId: string, projectId: string, dataset: string) {
  await seedAllProjectSyncQueue(companyId, dataset);
  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_sync_project_states (
        company_id, project_id, dataset, next_run_at, created_at, updated_at
      ) VALUES ($1, $2, $3, NOW(), NOW(), NOW())
      ON CONFLICT (company_id, project_id, dataset)
      DO UPDATE SET next_run_at = LEAST(procore_sync_project_states.next_run_at, NOW()), updated_at = NOW()
    `,
    companyId,
    projectId,
    dataset
  );
}

export async function POST(request: NextRequest) {
  if (!hasValidSecret(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const syncSecret = getRequiredSyncSecret();
  if (!syncSecret) {
    return NextResponse.json({ success: false, error: "PROCORE_SYNC_SECRET is not configured" }, { status: 503 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const reconciliation = String(body.mode || "").trim().toLowerCase() === "reconcile";
  const dataset = reconciliation ? RECONCILIATION_DATASET : ACTUALS_DATASET;
  const requestedCompanyId = String(body.companyId || request.nextUrl.searchParams.get("companyId") || "").trim();
  if (requestedCompanyId && requestedCompanyId !== SINGLE_ALLOWED_PROCORE_COMPANY_ID) {
    return NextResponse.json({ success: false, error: "Forbidden company context for this deployment." }, { status: 403 });
  }
  const companyId = requestedCompanyId || SINGLE_ALLOWED_PROCORE_COMPANY_ID;
  const explicitProjectId = parseProjectIds(body.projectIds || request.nextUrl.searchParams.get("projectIds"))[0] || null;
  const worker = await acquireProcoreWorker(companyId);
  if (!worker.acquired) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: worker.reason,
      rateLimitUntil: worker.control?.rate_limit_until || null,
      workerLockedUntil: worker.control?.worker_locked_until || null,
    });
  }

  let project: QueuedProject | null = null;
  const startedAt = Date.now();
  let logId: bigint | null = null;
  try {
    if (explicitProjectId) await ensureExplicitProject(companyId, explicitProjectId, dataset);
    else await seedAllProjectSyncQueue(companyId, dataset);
    project = await claimDueProject({
      companyId,
      dataset,
      leaseId: worker.leaseId,
      projectId: explicitProjectId || undefined,
    });
    if (!project) {
      return NextResponse.json({ success: true, skipped: true, reason: "no_project_due", dataset });
    }

    const { startDate, endDate } = dateWindow(body, reconciliation);
    const perPage = Math.min(200, Math.max(1, Number(body.perPage || process.env.PROCORE_ACTUALS_SYNC_PER_PAGE || 100) || 100));
    const selection = {
      step: "select-project",
      status: "ok",
      projectId: project.projectId,
      projectNumber: project.projectNumber,
      projectName: project.projectName,
      dataset,
    };
    const log = await prisma.syncLog.create({
      data: {
        companyId,
        triggeredBy: explicitProjectId
          ? "actuals-manual"
          : reconciliation ? "actuals-reconciliation-queue" : "actuals-queue",
        steps: [selection],
      },
      select: { id: true },
    }).catch(() => null);
    logId = log?.id ?? null;

    const commonBody = {
      companyId,
      projectIds: [project.projectId],
      startDate,
      endDate,
      perPage,
      concurrency: 1,
      forceUserOAuth: false,
      persist: true,
      persistUnpackedFields: false,
    };
    const steps: StepResult[] = [];
    for (const stage of [
      { step: "timecard-entries", path: "/api/procore/sync/timecard-entries" },
      { step: "productivity-logs", path: "/api/procore/sync/productivity-projects" },
    ]) {
      const result = await runStep({
        origin: request.nextUrl.origin.replace(/\/$/, ""),
        syncSecret,
        path: stage.path,
        step: stage.step,
        body: commonBody,
      });
      steps.push(result);
      if (result.status === "error") break;
    }

    const success = steps.length === 2 && steps.every((step) => step.status === "ok");
    const limited = steps.find((step) => step.rateLimited);
    const error = success ? null : JSON.stringify(steps.find((step) => step.status === "error")?.detail || "Actuals sync failed").slice(0, 4_000);
    const polling = success
      ? await pollingCadence(companyId, project.projectId, reconciliation)
      : null;
    if (limited?.rateLimitUntil) {
      await setProcoreRateLimit({ companyId, until: new Date(limited.rateLimitUntil), error });
    }
    await finishProjectSync({
      project,
      success,
      nextRunMinutes: limited?.rateLimitUntil
        ? Math.max(15, Math.ceil((new Date(limited.rateLimitUntil).getTime() - Date.now()) / 60_000))
        : success ? polling?.nextRunMinutes || 90 : 15,
      error,
      result: { selection, startDate, endDate, polling, steps },
    });

    const queueStats = await getSyncQueueStats(companyId, dataset);
    const batchCap = boundedNumber(process.env.PROCORE_ACTUALS_MAX_PROJECTS_PER_TICK, 8, 3, 12);
    const recommendedBatchSize = Math.min(
      batchCap,
      Math.max(3, Math.ceil(queueStats.due_projects / 12))
    );
    const totalMs = Date.now() - startedAt;
    if (logId !== null) {
      await prisma.syncLog.update({
        where: { id: logId },
        data: { finishedAt: new Date(), success, totalMs, steps: [selection, ...steps] as object[], error },
      }).catch(() => undefined);
    }
    return NextResponse.json({
      success,
      companyId,
      projectId: project.projectId,
      dataset,
      syncWindow: { startDate, endDate },
      polling,
      queue: {
        projectCount: queueStats.project_count,
        dueProjects: queueStats.due_projects,
        neverSucceeded: queueStats.never_succeeded,
        failedProjects: queueStats.failed_projects,
        recommendedBatchSize,
        maxBatchSize: batchCap,
      },
      logId: logId?.toString() || null,
      totalMs,
      steps,
    }, { status: success ? 200 : 207 });
  } finally {
    if (project) {
      await prisma.$executeRawUnsafe(
        `UPDATE procore_sync_project_states SET locked_by = NULL, locked_until = NULL, updated_at = NOW() WHERE company_id = $1 AND project_id = $2 AND dataset = $3 AND locked_by = $4`,
        companyId,
        project.projectId,
        dataset,
        worker.leaseId
      ).catch(() => undefined);
    }
    await releaseProcoreWorker(companyId, worker.leaseId).catch(() => undefined);
  }
}

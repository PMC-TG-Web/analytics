import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequiredSyncSecret } from "@/lib/cronSync";
import {
  acquireProcoreWorker,
  claimDueProject,
  finishProjectSync,
  releaseProcoreWorker,
  seedEstimatingSyncQueue,
  seedProjectSyncQueue,
  setProcoreRateLimit,
  type QueuedProject,
} from "@/lib/procoreSyncQueue";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DATASET = "nightly_structure";
const ESTIMATING_DATASET = "nightly_estimates";
const COMPANY_ID = (process.env.PROCORE_COMPANY_ID || "598134325805519").trim();

type StepResult = {
  step: string;
  status: "ok" | "error";
  httpStatus: number;
  rateLimited?: boolean;
  rateLimitUntil?: string;
  detail?: unknown;
};

function authorized(request: NextRequest) {
  const provided = request.headers.get("x-sync-secret")?.trim()
    || request.headers.get("x-cron-secret")?.trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const syncSecret = getRequiredSyncSecret();
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return Boolean(provided) && (provided === syncSecret || (!!cronSecret && provided === cronSecret));
}

async function readDetail(response: Response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; } catch { return text; }
}

function hasErrors(detail: unknown) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return false;
  const value = detail as Record<string, unknown>;
  return value.success === false || (Array.isArray(value.errors) && value.errors.length > 0);
}

function limited(status: number, detail: unknown) {
  return status === 429 || /\b429\b|rate limit|too many requests|surpassed the max number of requests/i.test(JSON.stringify(detail));
}

function resetAt(response: Response) {
  const reset = Number(response.headers.get("x-rate-limit-reset") || 0);
  const retry = Number(response.headers.get("retry-after") || 0);
  return new Date(Math.max(
    Date.now() + 15 * 60_000,
    reset > 0 ? reset * 1_000 + 3_000 : 0,
    retry > 0 ? Date.now() + retry * 1_000 + 2_000 : 0
  ));
}

async function runStep(params: {
  origin: string;
  secret: string;
  projectId: string;
  step: string;
  path: string;
}) {
  try {
    const response = await fetch(`${params.origin}${params.path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-secret": params.secret },
      body: JSON.stringify({
        companyId: COMPANY_ID,
        projectIds: [params.projectId],
        perPage: 100,
        concurrency: 1,
        persist: true,
        forceUserOAuth: false,
      }),
      signal: AbortSignal.timeout(4 * 60_000),
    });
    const detail = await readDetail(response);
    const rateLimited = limited(response.status, detail);
    const until = rateLimited ? resetAt(response) : null;
    return {
      step: params.step,
      status: response.ok && !hasErrors(detail) && !rateLimited ? "ok" : "error",
      httpStatus: response.status,
      rateLimited,
      rateLimitUntil: until?.toISOString(),
      detail,
    } satisfies StepResult;
  } catch (error) {
    return {
      step: params.step,
      status: "error",
      httpStatus: 0,
      detail: error instanceof Error ? error.message : String(error),
    } satisfies StepResult;
  }
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const secret = getRequiredSyncSecret();
  if (!secret) {
    return NextResponse.json({ success: false, error: "Missing PROCORE_SYNC_SECRET" }, { status: 503 });
  }

  const worker = await acquireProcoreWorker(COMPANY_ID);
  if (!worker.acquired) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: worker.reason,
      rateLimitUntil: worker.control?.rate_limit_until || null,
    });
  }

  let project: QueuedProject | null = null;
  const estimatingProjects: QueuedProject[] = [];
  let logId: bigint | null = null;
  const startedAt = Date.now();
  try {
    await seedProjectSyncQueue(COMPANY_ID, DATASET);
    project = await claimDueProject({ companyId: COMPANY_ID, dataset: DATASET, leaseId: worker.leaseId });
    if (!project) {
      await seedEstimatingSyncQueue(COMPANY_ID, ESTIMATING_DATASET);
      for (let index = 0; index < 5; index += 1) {
        const estimateProject = await claimDueProject({
          companyId: COMPANY_ID,
          dataset: ESTIMATING_DATASET,
          leaseId: worker.leaseId,
        });
        if (!estimateProject) break;
        estimatingProjects.push(estimateProject);
      }
      if (!estimatingProjects.length) {
        return NextResponse.json({ success: true, skipped: true, reason: "no_project_due", dataset: DATASET });
      }

      const response = await fetch(`${request.nextUrl.origin.replace(/\/$/, "")}/api/procore/estimating/proposal-line-items-bulk`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-sync-secret": secret },
        body: JSON.stringify({
          companyId: COMPANY_ID,
          fetchAll: true,
          persist: true,
          includeProjectSummaries: false,
          includeLineItems: false,
          perPage: 100,
          "filters[by_status]": "All",
          bidBoardProjectIds: estimatingProjects.map((item) => item.projectId),
          maxBidBoardProjects: estimatingProjects.length,
          maxProposalsPerProject: 50,
          maxLineItemsPages: 100,
        }),
        signal: AbortSignal.timeout(4 * 60_000),
      });
      const detail = await readDetail(response);
      const rateLimited = limited(response.status, detail);
      const success = response.ok && !hasErrors(detail) && !rateLimited;
      const until = rateLimited ? resetAt(response) : null;
      const error = success ? null : JSON.stringify(detail).slice(0, 4_000);
      if (until) await setProcoreRateLimit({ companyId: COMPANY_ID, until, error });
      for (const estimateProject of estimatingProjects) {
        await finishProjectSync({
          project: estimateProject,
          success,
          nextRunMinutes: until
            ? Math.max(15, Math.ceil((until.getTime() - Date.now()) / 60_000))
            : success ? 24 * 60 : 30,
          error,
          result: detail,
        });
      }
      return NextResponse.json({
        success,
        companyId: COMPANY_ID,
        dataset: ESTIMATING_DATASET,
        projectIds: estimatingProjects.map((item) => item.projectId),
        detail,
      }, { status: success ? 200 : 207 });
    }

    const selection = {
      step: "select-project",
      status: "ok",
      projectId: project.projectId,
      projectNumber: project.projectNumber,
      projectName: project.projectName,
      dataset: DATASET,
    };
    const log = await prisma.syncLog.create({
      data: { companyId: COMPANY_ID, triggeredBy: "nightly-structure-queue", steps: [selection] },
      select: { id: true },
    }).catch(() => null);
    logId = log?.id ?? null;

    const stages = [
      {
        step: "purchase-order-line-item-details",
        path: "/api/procore/sync/purchase-order-line-item-details",
      },
      {
        step: "budget-line-items",
        path: "/api/procore/sync/budget-line-items",
      },
      {
        step: "change-order-packages",
        path: "/api/procore/sync/change-order-packages",
      },
      {
        step: "commitment-change-order-line-items",
        path: "/api/procore/sync/commitment-change-order-line-items",
      },
    ];
    const steps: StepResult[] = [];
    for (const stage of stages) {
      const result = await runStep({
        origin: request.nextUrl.origin.replace(/\/$/, ""),
        secret,
        projectId: project.projectId,
        ...stage,
      });
      steps.push(result);
      if (result.status === "error") break;
    }

    const success = steps.length === stages.length && steps.every((step) => step.status === "ok");
    const rateLimit = steps.find((step) => step.rateLimited);
    const error = success ? null : JSON.stringify(steps.find((step) => step.status === "error")?.detail || "Nightly structural sync failed").slice(0, 4_000);
    if (rateLimit?.rateLimitUntil) {
      await setProcoreRateLimit({ companyId: COMPANY_ID, until: new Date(rateLimit.rateLimitUntil), error });
    }
    await finishProjectSync({
      project,
      success,
      nextRunMinutes: rateLimit?.rateLimitUntil
        ? Math.max(15, Math.ceil((new Date(rateLimit.rateLimitUntil).getTime() - Date.now()) / 60_000))
        : success ? 24 * 60 : 30,
      error,
      result: { selection, steps },
    });

    const totalMs = Date.now() - startedAt;
    if (logId !== null) {
      await prisma.syncLog.update({
        where: { id: logId },
        data: { finishedAt: new Date(), success, totalMs, steps: [selection, ...steps] as object[], error },
      }).catch(() => undefined);
    }
    return NextResponse.json({
      success,
      companyId: COMPANY_ID,
      projectId: project.projectId,
      dataset: DATASET,
      logId: logId?.toString() || null,
      totalMs,
      steps,
    }, { status: success ? 200 : 207 });
  } finally {
    if (project) {
      await prisma.$executeRawUnsafe(
        `UPDATE procore_sync_project_states SET locked_by = NULL, locked_until = NULL, updated_at = NOW() WHERE company_id = $1 AND project_id = $2 AND dataset = $3 AND locked_by = $4`,
        COMPANY_ID,
        project.projectId,
        DATASET,
        worker.leaseId
      ).catch(() => undefined);
    }
    for (const estimateProject of estimatingProjects) {
      await prisma.$executeRawUnsafe(
        `UPDATE procore_sync_project_states SET locked_by = NULL, locked_until = NULL, updated_at = NOW() WHERE company_id = $1 AND project_id = $2 AND dataset = $3 AND locked_by = $4`,
        COMPANY_ID,
        estimateProject.projectId,
        ESTIMATING_DATASET,
        worker.leaseId
      ).catch(() => undefined);
    }
    await releaseProcoreWorker(COMPANY_ID, worker.leaseId).catch(() => undefined);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequiredSyncSecret } from "@/lib/cronSync";
import {
  acquireProcoreWorker,
  claimDueProject,
  finishProjectSync,
  releaseProcoreWorker,
  setProcoreRateLimit,
  type QueuedProject,
} from "@/lib/procoreSyncQueue";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const COMPANY_ID = (process.env.PROCORE_COMPANY_ID || "598134325805519").trim();
const DATASET = "project_onboarding";

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

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function hasErrors(detail: unknown) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return false;
  const value = detail as Record<string, unknown>;
  return value.success === false || (Array.isArray(value.errors) && value.errors.length > 0);
}

function isRateLimited(status: number, detail: unknown) {
  return status === 429
    || /\b429\b|rate limit|too many requests|surpassed the max number of requests/i.test(JSON.stringify(detail));
}

function rateLimitReset(response: Response) {
  const reset = Number(response.headers.get("x-rate-limit-reset") || 0);
  const retryAfter = Number(response.headers.get("retry-after") || 0);
  return new Date(Math.max(
    Date.now() + 15 * 60_000,
    reset > 0 ? reset * 1_000 + 3_000 : 0,
    retryAfter > 0 ? Date.now() + retryAfter * 1_000 + 2_000 : 0
  ));
}

async function responseDetail(response: Response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return text;
  }
}

async function runStep(params: {
  origin: string;
  secret: string;
  step: string;
  path: string;
  body: Record<string, unknown>;
}): Promise<StepResult> {
  try {
    const response = await fetch(`${params.origin}${params.path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sync-secret": params.secret,
      },
      body: JSON.stringify(params.body),
      signal: AbortSignal.timeout(4 * 60_000),
    });
    const detail = await responseDetail(response);
    const rateLimited = isRateLimited(response.status, detail);
    const success = response.ok && !hasErrors(detail) && !rateLimited;
    const until = rateLimited ? rateLimitReset(response) : null;
    return {
      step: params.step,
      status: success ? "ok" : "error",
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

async function linkedBidBoardIds(companyId: string, projectId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ bid_board_id: string }>>(
    `
      SELECT bid_board_id
      FROM pmc_bid_board_projects
      WHERE company_id = $1
        AND procore_project_id = $2
        AND POSITION(':' IN bid_board_id) = 0
        AND NOT (COALESCE(payload, '{}'::jsonb) @> '{"archived":true}'::jsonb)
        AND NOT (COALESCE(payload, '{}'::jsonb) @> '{"deleted":true}'::jsonb)
        AND NOT (COALESCE(payload, '{}'::jsonb) @> '{"is_template":true}'::jsonb)
        AND NOT (COALESCE(payload, '{}'::jsonb) @> '{"sync_missing_from_procore":true}'::jsonb)
      ORDER BY synced_at DESC, bid_board_id
    `,
    companyId,
    projectId
  );
  return rows.map((row) => row.bid_board_id);
}

function estimateReadiness(detail: unknown) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
    return { ready: false, proposalCount: 0, lineItemCount: 0 };
  }
  const value = detail as Record<string, unknown>;
  const summaries = Array.isArray(value.projectSummaries)
    ? value.projectSummaries as Array<Record<string, unknown>>
    : [];
  const proposalCount = summaries.reduce(
    (total, summary) => total + (Number(summary.proposalCount) || 0),
    0
  );
  const counts = value.counts && typeof value.counts === "object" && !Array.isArray(value.counts)
    ? value.counts as Record<string, unknown>
    : {};
  const lineItemCount = Number(counts.lineItems)
    || summaries.reduce((total, summary) => total + (Number(summary.lineItemCount) || 0), 0);
  return {
    ready: proposalCount > 0 && lineItemCount > 0,
    proposalCount,
    lineItemCount,
  };
}

async function markRelatedQueuesCurrent(params: {
  companyId: string;
  project: QueuedProject;
  bidBoardIds: string[];
}) {
  const statusRows = await prisma.$queryRawUnsafe<Array<{
    status: string | null;
    has_budget: boolean;
  }>>(
    `
      SELECT
        COALESCE(NULLIF(BTRIM(project.bid_board_status), ''), NULLIF(BTRIM(project.status), '')) AS status,
        EXISTS (
          SELECT 1
          FROM budgetlineitems budget
          WHERE budget.company_id = project.company_id
            AND budget.project_id = project.procore_project_id
        ) AS has_budget
      FROM pmc_projects project
      WHERE project.company_id = $1
        AND project.procore_project_id = $2
      LIMIT 1
    `,
    params.companyId,
    params.project.projectId
  );
  const status = String(statusRows[0]?.status || "").trim().toLowerCase();
  const active = ["in progress", "active", "course of construction"].includes(status);
  const actualsMinutes = active ? 90 : 24 * 60;

  for (const state of [
    { projectId: params.project.projectId, dataset: "actuals", nextRunMinutes: actualsMinutes },
    ...(statusRows[0]?.has_budget
      ? [{ projectId: params.project.projectId, dataset: "nightly_structure", nextRunMinutes: 24 * 60 }]
      : []),
    ...params.bidBoardIds.map((projectId) => ({
      projectId,
      dataset: "nightly_estimates",
      nextRunMinutes: 24 * 60,
    })),
  ]) {
    await prisma.$executeRawUnsafe(
      `
        INSERT INTO procore_sync_project_states (
          company_id, project_id, dataset, project_number, project_name,
          last_attempt_at, last_success_at, next_run_at, failure_count,
          last_error, created_at, updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5,
          NOW(), NOW(), NOW() + ($6 * INTERVAL '1 minute'), 0,
          NULL, NOW(), NOW()
        )
        ON CONFLICT (company_id, project_id, dataset)
        DO UPDATE SET
          project_number = COALESCE(EXCLUDED.project_number, procore_sync_project_states.project_number),
          project_name = COALESCE(EXCLUDED.project_name, procore_sync_project_states.project_name),
          last_attempt_at = NOW(),
          last_success_at = NOW(),
          next_run_at = NOW() + ($6 * INTERVAL '1 minute'),
          locked_by = NULL,
          locked_until = NULL,
          failure_count = 0,
          last_error = NULL,
          updated_at = NOW()
      `,
      params.companyId,
      state.projectId,
      state.dataset,
      params.project.projectNumber,
      params.project.projectName,
      state.nextRunMinutes
    );
  }
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const secret = getRequiredSyncSecret();
  if (!secret) {
    return NextResponse.json({ success: false, error: "PROCORE_SYNC_SECRET is not configured" }, { status: 503 });
  }

  const worker = await acquireProcoreWorker(COMPANY_ID);
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
  let logId: bigint | null = null;
  const startedAt = Date.now();
  try {
    project = await claimDueProject({
      companyId: COMPANY_ID,
      dataset: DATASET,
      leaseId: worker.leaseId,
    });
    if (!project) {
      return NextResponse.json({ success: true, skipped: true, reason: "no_project_due", dataset: DATASET });
    }

    const selection = {
      step: "select-project",
      status: "ok",
      dataset: DATASET,
      projectId: project.projectId,
      projectNumber: project.projectNumber,
      projectName: project.projectName,
    };
    const log = await prisma.syncLog.create({
      data: {
        companyId: COMPANY_ID,
        triggeredBy: "project-onboarding-queue",
        steps: [selection],
      },
      select: { id: true },
    }).catch(() => null);
    logId = log?.id ?? null;

    const origin = request.nextUrl.origin.replace(/\/$/, "");
    const commonProjectBody = {
      companyId: COMPANY_ID,
      projectIds: [project.projectId],
      perPage: 100,
      concurrency: 1,
      persist: true,
      forceUserOAuth: false,
    };
    const now = Date.now();
    const actualsBody = {
      ...commonProjectBody,
      startDate: dateKey(new Date(now - 45 * 86_400_000)),
      endDate: dateKey(new Date(now)),
    };
    const steps: StepResult[] = [];

    const headerStep = await runStep({
      origin,
      secret,
      step: "bid-board-projects",
      path: "/api/procore/sync/bid-board-projects",
      body: { companyId: COMPANY_ID },
    });
    steps.push(headerStep);

    let bidBoardIds: string[] = [];
    if (headerStep.status === "ok") {
      bidBoardIds = await linkedBidBoardIds(COMPANY_ID, project.projectId);
      if (!bidBoardIds.length) {
        steps.push({
          step: "estimate-proposal-line-items",
          status: "error",
          httpStatus: 404,
          detail: "The project is not linked to a current Procore Bid Board record yet.",
        });
      } else {
        const estimateStep = await runStep({
          origin,
          secret,
          step: "estimate-proposal-line-items",
          path: "/api/procore/estimating/proposal-line-items-bulk",
          body: {
            companyId: COMPANY_ID,
            fetchAll: true,
            persist: true,
            includeProjectSummaries: true,
            includeLineItems: false,
            perPage: 100,
            "filters[by_status]": "All",
            bidBoardProjectIds: bidBoardIds,
            maxBidBoardProjects: bidBoardIds.length,
            maxProposalsPerProject: 50,
            maxLineItemsPages: 100,
          },
        });
        if (estimateStep.status === "ok") {
          const readiness = estimateReadiness(estimateStep.detail);
          if (!readiness.ready) {
            estimateStep.status = "error";
            estimateStep.httpStatus = 202;
            estimateStep.detail = {
              waitingFor: "Procore estimate proposal line items",
              ...readiness,
            };
          }
        }
        steps.push(estimateStep);
      }
    }

    for (const stage of [
      { step: "purchase-order-line-item-details", path: "/api/procore/sync/purchase-order-line-item-details", body: commonProjectBody },
      { step: "budget-line-items", path: "/api/procore/sync/budget-line-items", body: commonProjectBody },
      { step: "change-order-packages", path: "/api/procore/sync/change-order-packages", body: commonProjectBody },
      { step: "commitment-change-order-line-items", path: "/api/procore/sync/commitment-change-order-line-items", body: commonProjectBody },
      { step: "timecard-entries", path: "/api/procore/sync/timecard-entries", body: actualsBody },
      { step: "productivity-logs", path: "/api/procore/sync/productivity-projects", body: actualsBody },
    ]) {
      if (steps.some((step) => step.status === "error")) break;
      steps.push(await runStep({ origin, secret, ...stage }));
    }

    const success = steps.length === 8 && steps.every((step) => step.status === "ok");
    const limited = steps.find((step) => step.rateLimited);
    const failedStep = steps.find((step) => step.status === "error");
    const waitingForProcore = failedStep?.httpStatus === 202 || failedStep?.httpStatus === 404;
    const error = success ? null : JSON.stringify(failedStep?.detail || "Project onboarding failed").slice(0, 4_000);
    if (limited?.rateLimitUntil) {
      await setProcoreRateLimit({
        companyId: COMPANY_ID,
        until: new Date(limited.rateLimitUntil),
        error,
      });
    }
    if (success) {
      await markRelatedQueuesCurrent({
        companyId: COMPANY_ID,
        project,
        bidBoardIds,
      });
    }
    await finishProjectSync({
      project,
      success,
      nextRunMinutes: limited?.rateLimitUntil
        ? Math.max(15, Math.ceil((new Date(limited.rateLimitUntil).getTime() - Date.now()) / 60_000))
        : success ? 365 * 24 * 60 : waitingForProcore ? 30 : 15,
      error,
      result: { selection, bidBoardIds, steps },
    });

    const totalMs = Date.now() - startedAt;
    if (logId !== null) {
      await prisma.syncLog.update({
        where: { id: logId },
        data: {
          finishedAt: new Date(),
          success,
          totalMs,
          steps: [selection, ...steps] as object[],
          error,
        },
      }).catch(() => undefined);
    }
    return NextResponse.json({
      success,
      companyId: COMPANY_ID,
      dataset: DATASET,
      projectId: project.projectId,
      bidBoardIds,
      logId: logId?.toString() || null,
      totalMs,
      steps,
    }, { status: success ? 200 : 207 });
  } finally {
    if (project) {
      await prisma.$executeRawUnsafe(
        `
          UPDATE procore_sync_project_states
          SET locked_by = NULL, locked_until = NULL, updated_at = NOW()
          WHERE company_id = $1
            AND project_id = $2
            AND dataset = $3
            AND locked_by = $4
        `,
        COMPANY_ID,
        project.projectId,
        DATASET,
        worker.leaseId
      ).catch(() => undefined);
    }
    await releaseProcoreWorker(COMPANY_ID, worker.leaseId).catch(() => undefined);
  }
}

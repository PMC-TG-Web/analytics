import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequiredSyncSecret } from "@/lib/cronSync";
import {
  acquireProcoreWorker,
  claimDueProject,
  deferProjectSync,
  finishProjectSync,
  releaseProcoreWorker,
  seedEstimatingSyncQueue,
  seedMissingPurchaseOrderLineQueue,
  seedProjectSyncQueue,
  seedSingletonSyncQueue,
  setProcoreRateLimit,
  type QueuedProject,
} from "@/lib/procoreSyncQueue";
import {
  procoreSyncDetailHasErrors,
  procoreSyncRateLimitUntil,
  procoreSyncResponseIsRateLimited,
} from "@/lib/procoreSyncResponse";
import { procoreQuotaObservation } from "@/lib/procoreRateLimit";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DATASET = "nightly_structure";
const ESTIMATING_DATASET = "nightly_estimates";
const BID_BOARD_DATASET = "nightly_bid_board_headers";
const PO_DISCOVERY_DATASET = "purchase_order_discovery";
const BID_BOARD_QUEUE_ID = "__company_bid_board__";
const COMPANY_ID = (process.env.PROCORE_COMPANY_ID || "598134325805519").trim();
// The scheduler runs every five minutes. Requeue one tick before 24 hours so a
// job completed a few seconds after a tick cannot miss the next nightly window.
const DAILY_REQUEUE_MINUTES = 24 * 60 - 5;
const BID_BOARD_SYNC_INTERVAL_MINUTES = Math.min(
  360,
  Math.max(60, Number.parseInt(process.env.PROCORE_BID_BOARD_SYNC_INTERVAL_MINUTES || "60", 10) || 60)
);

type StepResult = {
  step: string;
  status: "ok" | "error";
  httpStatus: number;
  rateLimited?: boolean;
  rateLimitUntil?: string;
  rateLimitInherited?: boolean;
  apiRequests?: number;
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

function resetAt(response: Response, detail: unknown) {
  const headerValue = response.headers.get("x-procore-rate-limit-until");
  const headerDate = headerValue ? new Date(headerValue) : null;
  const inherited = procoreSyncRateLimitUntil(detail)
    || (headerDate && Number.isFinite(headerDate.getTime()) ? headerDate : null);
  if (inherited) return { until: inherited, inherited: true };
  return { until: procoreQuotaObservation(response.headers, 429, {
    reserve: 0,
    fallbackCooldownMs: 15 * 60_000,
    resetPaddingMs: 3_000,
  }).cooldownUntil!, inherited: false };
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
        persistUnpackedFields: false,
        forceUserOAuth: false,
      }),
      signal: AbortSignal.timeout(4 * 60_000),
    });
    const detail = await readDetail(response);
    const rateLimited = procoreSyncResponseIsRateLimited(response.status, detail);
    const reset = rateLimited ? resetAt(response, detail) : null;
    const apiRequests = Number.parseInt(response.headers.get("x-procore-api-request-count") || "0", 10) || 0;
    return {
      step: params.step,
      status: response.ok && !procoreSyncDetailHasErrors(detail) && !rateLimited ? "ok" : "error",
      httpStatus: response.status,
      rateLimited,
      rateLimitUntil: reset?.until.toISOString(),
      rateLimitInherited: reset?.inherited,
      apiRequests,
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
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const mode = String(body.mode || "").trim().toLowerCase();
  const requestedProjectId = String(body.projectId || "").trim();
  const estimateOnly = mode === "estimates";
  const bidBoardOnly = mode === "bid-board-headers" || mode === "headers";
  const poDiscoveryOnly = mode === "po-discovery" || mode === "purchase-orders";

  const worker = await acquireProcoreWorker(COMPANY_ID);
  if (!worker.acquired) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: worker.reason,
      rateLimitUntil: worker.control?.rate_limit_until || null,
    });
  }

  let bidBoardProject: QueuedProject | null = null;
  let poDiscoveryProject: QueuedProject | null = null;
  let project: QueuedProject | null = null;
  const estimatingProjects: QueuedProject[] = [];
  let logId: bigint | null = null;
  const startedAt = Date.now();
  try {
    if (poDiscoveryOnly) {
      await seedMissingPurchaseOrderLineQueue(COMPANY_ID, PO_DISCOVERY_DATASET);
      poDiscoveryProject = await claimDueProject({
        companyId: COMPANY_ID,
        dataset: PO_DISCOVERY_DATASET,
        leaseId: worker.leaseId,
        newestFirst: true,
      });
      if (!poDiscoveryProject) {
        return NextResponse.json({
          success: true,
          skipped: true,
          reason: "no_purchase_order_discovery_project_due",
          dataset: PO_DISCOVERY_DATASET,
        });
      }

      const selection = {
        step: "select-project",
        status: "ok",
        projectId: poDiscoveryProject.projectId,
        projectNumber: poDiscoveryProject.projectNumber,
        projectName: poDiscoveryProject.projectName,
        dataset: PO_DISCOVERY_DATASET,
      };
      const log = await prisma.syncLog.create({
        data: { companyId: COMPANY_ID, triggeredBy: "purchase-order-discovery", steps: [selection] },
        select: { id: true },
      }).catch(() => null);
      logId = log?.id ?? null;

      const step = await runStep({
        origin: request.nextUrl.origin.replace(/\/$/, ""),
        secret,
        projectId: poDiscoveryProject.projectId,
        step: "purchase-order-line-item-details",
        path: "/api/procore/sync/purchase-order-line-item-details",
      });
      const countRows = await prisma.$queryRawUnsafe<Array<{ line_count: number }>>(
        `
          SELECT COUNT(*)::int AS line_count
          FROM "PurchaseOrderLineItemContractDetail"
          WHERE "procoreCompanyId" = $1
            AND "procoreProjectId" = $2
        `,
        COMPANY_ID,
        poDiscoveryProject.projectId
      );
      const lineCount = Number(countRows[0]?.line_count || 0);
      const success = step.status === "ok";
      const error = success
        ? null
        : JSON.stringify(step.detail || "Purchase order discovery failed").slice(0, 4_000);
      const rateLimitUntil = step.rateLimited && step.rateLimitUntil
        ? new Date(step.rateLimitUntil)
        : null;
      if (rateLimitUntil) {
        if (!step.rateLimitInherited) {
          await setProcoreRateLimit({
            companyId: COMPANY_ID,
            until: rateLimitUntil,
            error,
          });
        }
        await deferProjectSync({
          project: poDiscoveryProject,
          until: rateLimitUntil,
          result: { selection, step, lineCount, deferredBy: "procore-rate-limit" },
        });
      } else {
        await finishProjectSync({
          project: poDiscoveryProject,
          success,
          nextRunMinutes: success && lineCount > 0 ? 365 * 24 * 60 : 30,
          error,
          result: { selection, step, lineCount },
        });
      }

      const totalMs = Date.now() - startedAt;
      if (logId !== null) {
        await prisma.syncLog.update({
          where: { id: logId },
          data: {
            finishedAt: new Date(),
            success: success || Boolean(rateLimitUntil),
            totalMs,
            steps: [selection, step, { step: "cached-line-count", status: "ok", lineCount }] as object[],
            error: rateLimitUntil ? null : error,
          },
        }).catch(() => undefined);
      }
      return NextResponse.json({
        success: success || Boolean(rateLimitUntil),
        completed: success,
        deferred: Boolean(rateLimitUntil),
        companyId: COMPANY_ID,
        projectId: poDiscoveryProject.projectId,
        projectNumber: poDiscoveryProject.projectNumber,
        projectName: poDiscoveryProject.projectName,
        dataset: PO_DISCOVERY_DATASET,
        lineCount,
        totalMs,
        steps: [step],
      }, { status: success || rateLimitUntil ? 200 : 207 });
    }

    if (!estimateOnly) {
    if (!requestedProjectId) {
    await seedSingletonSyncQueue({
      companyId: COMPANY_ID,
      dataset: BID_BOARD_DATASET,
      projectId: BID_BOARD_QUEUE_ID,
      projectName: "Company Bid Board headers",
    });
    bidBoardProject = await claimDueProject({
      companyId: COMPANY_ID,
      dataset: BID_BOARD_DATASET,
      leaseId: worker.leaseId,
    });
    if (bidBoardProject) {
      const selection = {
        step: "select-company-dataset",
        status: "ok",
        projectId: BID_BOARD_QUEUE_ID,
        projectName: bidBoardProject.projectName,
        dataset: BID_BOARD_DATASET,
      };
      const log = await prisma.syncLog.create({
        data: { companyId: COMPANY_ID, triggeredBy: "nightly-bid-board-headers", steps: [selection] },
        select: { id: true },
      }).catch(() => null);
      logId = log?.id ?? null;

      const step = await runStep({
        origin: request.nextUrl.origin.replace(/\/$/, ""),
        secret,
        projectId: BID_BOARD_QUEUE_ID,
        step: "bid-board-projects",
        path: "/api/procore/sync/bid-board-projects",
      });
      const success = step.status === "ok";
      const error = success ? null : JSON.stringify(step.detail || "Bid Board header sync failed").slice(0, 4_000);
      const rateLimitUntil = step.rateLimited && step.rateLimitUntil
        ? new Date(step.rateLimitUntil)
        : null;
      if (rateLimitUntil) {
        if (!step.rateLimitInherited) {
          await setProcoreRateLimit({
            companyId: COMPANY_ID,
            until: rateLimitUntil,
            error,
          });
        }
        await deferProjectSync({
          project: bidBoardProject,
          until: rateLimitUntil,
          result: { selection, step, deferredBy: "procore-rate-limit" },
        });
      } else {
        await finishProjectSync({
          project: bidBoardProject,
          success,
          nextRunMinutes: success ? BID_BOARD_SYNC_INTERVAL_MINUTES : Math.min(BID_BOARD_SYNC_INTERVAL_MINUTES, 30),
          error,
          result: { selection, step },
        });
      }

      const totalMs = Date.now() - startedAt;
      if (logId !== null) {
        await prisma.syncLog.update({
          where: { id: logId },
          data: {
            finishedAt: new Date(),
            success: success || Boolean(rateLimitUntil),
            totalMs,
            steps: [selection, step] as object[],
            error: rateLimitUntil ? null : error,
          },
        }).catch(() => undefined);
      }
      return NextResponse.json({
        success: success || Boolean(rateLimitUntil),
        completed: success,
        deferred: Boolean(rateLimitUntil),
        companyId: COMPANY_ID,
        dataset: BID_BOARD_DATASET,
        logId: logId?.toString() || null,
        totalMs,
        steps: [step],
      }, { status: success || rateLimitUntil ? 200 : 207 });
    }

    if (bidBoardOnly) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "bid_board_headers_not_due",
        dataset: BID_BOARD_DATASET,
      });
    }
    }

    await seedProjectSyncQueue(COMPANY_ID, DATASET);
    project = await claimDueProject({
      companyId: COMPANY_ID,
      dataset: DATASET,
      leaseId: worker.leaseId,
      projectId: requestedProjectId || undefined,
    });
    }
    if (!project) {
      if (requestedProjectId) {
        return NextResponse.json({
          success: false,
          skipped: true,
          reason: "requested_project_not_available",
          projectId: requestedProjectId,
          dataset: DATASET,
        }, { status: 404 });
      }
      await seedEstimatingSyncQueue(COMPANY_ID, ESTIMATING_DATASET);
      // Process estimates one project per request. This keeps a timeout or
      // project-level 403 from failing unrelated queue records in the batch.
      for (let index = 0; index < 1; index += 1) {
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
      const rateLimited = procoreSyncResponseIsRateLimited(response.status, detail);
      const success = response.ok && !procoreSyncDetailHasErrors(detail) && !rateLimited;
      const reset = rateLimited ? resetAt(response, detail) : null;
      const until = reset?.until || null;
      const apiRequests = Number.parseInt(response.headers.get("x-procore-api-request-count") || "0", 10) || 0;
      const error = success ? null : JSON.stringify(detail).slice(0, 4_000);
      if (until && !reset?.inherited) {
        await setProcoreRateLimit({ companyId: COMPANY_ID, until, error });
      }
      for (const estimateProject of estimatingProjects) {
        if (until) {
          await deferProjectSync({
            project: estimateProject,
            until,
            result: { detail, apiRequests, deferredBy: "procore-rate-limit" },
          });
        } else {
          await finishProjectSync({
            project: estimateProject,
            success,
            nextRunMinutes: success ? DAILY_REQUEUE_MINUTES : 30,
            error,
            result: { detail, apiRequests },
          });
        }
      }
      return NextResponse.json({
        success: success || Boolean(until),
        completed: success,
        deferred: Boolean(until),
        companyId: COMPANY_ID,
        dataset: ESTIMATING_DATASET,
        projectIds: estimatingProjects.map((item) => item.projectId),
        detail,
        apiRequests,
      }, { status: success || until ? 200 : 207 });
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
    const rateLimitUntil = rateLimit?.rateLimitUntil ? new Date(rateLimit.rateLimitUntil) : null;
    if (rateLimitUntil) {
      if (!rateLimit?.rateLimitInherited) {
        await setProcoreRateLimit({ companyId: COMPANY_ID, until: rateLimitUntil, error });
      }
      await deferProjectSync({
        project,
        until: rateLimitUntil,
        result: { selection, steps, deferredBy: "procore-rate-limit" },
      });
    } else {
      await finishProjectSync({
        project,
        success,
        nextRunMinutes: success ? DAILY_REQUEUE_MINUTES : 30,
        error,
        result: { selection, steps },
      });
    }

    const totalMs = Date.now() - startedAt;
    if (logId !== null) {
      await prisma.syncLog.update({
        where: { id: logId },
        data: {
          finishedAt: new Date(),
          success: success || Boolean(rateLimitUntil),
          totalMs,
          steps: [selection, ...steps] as object[],
          error: rateLimitUntil ? null : error,
        },
      }).catch(() => undefined);
    }
    return NextResponse.json({
      success: success || Boolean(rateLimitUntil),
      completed: success,
      deferred: Boolean(rateLimitUntil),
      companyId: COMPANY_ID,
      projectId: project.projectId,
      dataset: DATASET,
      logId: logId?.toString() || null,
      totalMs,
      steps,
    }, { status: success || rateLimitUntil ? 200 : 207 });
  } finally {
    if (bidBoardProject) {
      await prisma.$executeRawUnsafe(
        `UPDATE procore_sync_project_states SET locked_by = NULL, locked_until = NULL, updated_at = NOW() WHERE company_id = $1 AND project_id = $2 AND dataset = $3 AND locked_by = $4`,
        COMPANY_ID,
        bidBoardProject.projectId,
        BID_BOARD_DATASET,
        worker.leaseId
      ).catch(() => undefined);
    }
    if (poDiscoveryProject) {
      await prisma.$executeRawUnsafe(
        `UPDATE procore_sync_project_states SET locked_by = NULL, locked_until = NULL, updated_at = NOW() WHERE company_id = $1 AND project_id = $2 AND dataset = $3 AND locked_by = $4`,
        COMPANY_ID,
        poDiscoveryProject.projectId,
        PO_DISCOVERY_DATASET,
        worker.leaseId
      ).catch(() => undefined);
    }
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

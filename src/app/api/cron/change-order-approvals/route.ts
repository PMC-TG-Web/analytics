import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  getClientCredentialsToken,
  getCurrentProcoreRequestMetrics,
  hasValidProcoreSyncSecret,
  makeRequest,
  procoreConfig,
  withProcoreLiveApiBypassForSyncSecret,
} from "@/lib/procore";
import {
  acquireProcoreWorker,
  claimDueProject,
  deferProjectSync,
  finishProjectSync,
  getSyncQueueStats,
  releaseProcoreWorker,
  seedChangeOrderApprovalQueue,
  type QueuedProject,
} from "@/lib/procoreSyncQueue";
import { upsertChangeOrderPackage } from "@/lib/procoreChangeOrderPackages";
import {
  commitmentMakerChangeOrderContextFromRecord,
  isApprovedChangeOrderStatus,
} from "@/lib/procoreCommitmentMakerTasks";
import { enqueueCommitmentMakerTasks } from "@/lib/procoreCommitmentMakerTaskQueue";
import { upsertPotentialChangeOrder } from "@/lib/procorePotentialChangeOrders";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

const DATASET = "change_order_approvals";

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function asRows(payload: unknown): JsonObject[] {
  if (Array.isArray(payload)) {
    return payload.map(asObject).filter((item): item is JsonObject => Boolean(item));
  }
  const record = asObject(payload);
  if (!record) return [];
  for (const candidate of [record.data, record.potential_change_orders, record.change_order_packages]) {
    if (Array.isArray(candidate)) {
      return candidate.map(asObject).filter((item): item is JsonObject => Boolean(item));
    }
  }
  return [];
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function errorStatus(error: unknown) {
  return Number((error as { status?: unknown })?.status || 0);
}

function errorRateLimitUntil(error: unknown) {
  if (errorStatus(error) !== 429) return null;
  const supplied = (error as { rateLimitUntil?: unknown })?.rateLimitUntil;
  const parsed = supplied instanceof Date ? supplied : new Date(String(supplied || ""));
  return Number.isFinite(parsed.getTime())
    ? parsed
    : new Date(Date.now() + 15 * 60_000);
}

async function approvalPollingMinutes(companyId: string, projectId: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ status: string | null }>>(
    `
      SELECT COALESCE(NULLIF(BTRIM(bid_board_status), ''), NULLIF(BTRIM(status), '')) AS status
      FROM pmc_projects
      WHERE company_id = $1 AND procore_project_id = $2
      LIMIT 1
    `,
    companyId,
    projectId,
  );
  const status = String(rows[0]?.status || "").trim().toLowerCase();
  return ["active", "in progress", "course of construction"].includes(status) ? 90 : 6 * 60;
}

async function fetchAll(params: {
  accessToken: string;
  companyId: string;
  pathForPage: (page: number) => string;
}) {
  const rows: JsonObject[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const pageRows = asRows(await makeRequest(
      params.pathForPage(page),
      params.accessToken,
      { method: "GET", cache: "no-store" },
      params.companyId,
      [404],
    ));
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
  }
  return rows;
}

async function persistPotentialChangeOrder(params: {
  companyId: string;
  projectId: string;
  record: JsonObject;
}) {
  const changeOrderId = text(params.record.id);
  if (!changeOrderId) return false;
  const previous = await prisma.procorePotentialChangeOrder.findUnique({
    where: {
      companyId_projectId_changeOrderId: {
        companyId: params.companyId,
        projectId: params.projectId,
        changeOrderId,
      },
    },
    select: { status: true },
  });
  if (isApprovedChangeOrderStatus(params.record.status)
    && !isApprovedChangeOrderStatus(previous?.status)) {
    const changeOrder = commitmentMakerChangeOrderContextFromRecord(params.record);
    if (!changeOrder) return false;
    await enqueueCommitmentMakerTasks({
      companyId: params.companyId,
      projectId: params.projectId,
      changeOrder,
      userEmail: "procore-change-order-approval-poll@pmcdecor.com",
      taskKinds: ["commitment_verification"],
    });
  }
  await upsertPotentialChangeOrder(params);
  return true;
}

async function persistChangeOrderPackage(params: {
  companyId: string;
  projectId: string;
  contractId: string;
  record: JsonObject;
}) {
  const packageId = text(params.record.id);
  if (!packageId) return false;
  const previous = await prisma.procoreChangeOrderPackage.findUnique({
    where: {
      companyId_projectId_packageId: {
        companyId: params.companyId,
        projectId: params.projectId,
        packageId,
      },
    },
    select: { status: true },
  });
  if (isApprovedChangeOrderStatus(params.record.status)
    && !isApprovedChangeOrderStatus(previous?.status)) {
    const changeOrder = commitmentMakerChangeOrderContextFromRecord(params.record);
    if (!changeOrder) return false;
    await enqueueCommitmentMakerTasks({
      companyId: params.companyId,
      projectId: params.projectId,
      changeOrder,
      userEmail: "procore-change-order-approval-poll@pmcdecor.com",
      taskKinds: ["commitment_verification"],
    });
  }
  await upsertChangeOrderPackage(params);
  return true;
}

export async function POST(request: NextRequest) {
  if (!hasValidProcoreSyncSecret(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  return withProcoreLiveApiBypassForSyncSecret(request, async () => {
    const companyId = String(procoreConfig.companyId || "").trim();
    if (!companyId) {
      return NextResponse.json({ success: false, error: "PROCORE_COMPANY_ID is not configured." }, { status: 503 });
    }
    const worker = await acquireProcoreWorker(companyId, 3);
    if (!worker.acquired) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: worker.reason,
        dataset: DATASET,
        rateLimitUntil: worker.control?.rate_limit_until || null,
      });
    }

    let project: QueuedProject | null = null;
    let logId: bigint | null = null;
    const startedAt = Date.now();
    try {
      await seedChangeOrderApprovalQueue(companyId, DATASET);
      project = await claimDueProject({ companyId, dataset: DATASET, leaseId: worker.leaseId, leaseMinutes: 3 });
      if (!project) {
        return NextResponse.json({ success: true, skipped: true, reason: "no_project_due", dataset: DATASET });
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
        data: { companyId, triggeredBy: "change-order-approval-queue", steps: [selection] },
        select: { id: true },
      }).catch(() => null);
      logId = log?.id ?? null;

      try {
        const accessToken = await getClientCredentialsToken();
        let potentialChangeOrdersScanned = 0;
        let packagesScanned = 0;
        const potentialChangeOrders = await fetchAll({
          accessToken,
          companyId,
          pathForPage: (page) => `/rest/v1.0/potential_change_orders?project_id=${encodeURIComponent(project!.projectId)}&page=${page}&per_page=100`,
        });
        for (const record of potentialChangeOrders) {
          if (await persistPotentialChangeOrder({ companyId, projectId: project.projectId, record })) {
            potentialChangeOrdersScanned += 1;
          }
        }

        const primeContracts = await fetchAll({
          accessToken,
          companyId,
          pathForPage: (page) => `/rest/v1.0/prime_contracts?project_id=${encodeURIComponent(project!.projectId)}&page=${page}&per_page=100`,
        });
        for (const contract of primeContracts) {
          const contractId = text(contract.id);
          if (!contractId) continue;
          const packages = await fetchAll({
            accessToken,
            companyId,
            pathForPage: (page) => `/rest/v1.0/change_order_packages?project_id=${encodeURIComponent(project!.projectId)}&contract_id=${encodeURIComponent(contractId)}&page=${page}&per_page=100`,
          });
          for (const record of packages) {
            if (await persistChangeOrderPackage({ companyId, projectId: project.projectId, contractId, record })) {
              packagesScanned += 1;
            }
          }
        }

        const apiRequests = getCurrentProcoreRequestMetrics().apiRequests;
        const nextRunMinutes = await approvalPollingMinutes(companyId, project.projectId);
        const result = { selection, potentialChangeOrdersScanned, packagesScanned, apiRequests, nextRunMinutes };
        await finishProjectSync({ project, success: true, nextRunMinutes, result });
        const queue = await getSyncQueueStats(companyId, DATASET);
        if (logId !== null) {
          await prisma.syncLog.update({
            where: { id: logId },
            data: { finishedAt: new Date(), success: true, totalMs: Date.now() - startedAt, steps: [selection, result] },
          }).catch(() => undefined);
        }
        return NextResponse.json({
          success: true,
          dataset: DATASET,
          projectId: project.projectId,
          projectsScanned: 1,
          potentialChangeOrdersScanned,
          packagesScanned,
          apiRequests,
          queue,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const rateLimitUntil = errorRateLimitUntil(error);
        const apiRequests = getCurrentProcoreRequestMetrics().apiRequests;
        if (rateLimitUntil) {
          await deferProjectSync({
            project,
            until: rateLimitUntil,
            result: { selection, deferredBy: "procore-rate-limit", apiRequests },
          });
        } else {
          await finishProjectSync({ project, success: false, nextRunMinutes: 30, error: message, result: { selection, apiRequests } });
        }
        if (logId !== null) {
          await prisma.syncLog.update({
            where: { id: logId },
            data: {
              finishedAt: new Date(),
              success: Boolean(rateLimitUntil),
              totalMs: Date.now() - startedAt,
              steps: [selection, { step: "approval-headers", status: rateLimitUntil ? "deferred" : "error", apiRequests }],
              error: rateLimitUntil ? null : message.slice(0, 4_000),
            },
          }).catch(() => undefined);
        }
        return NextResponse.json({
          success: Boolean(rateLimitUntil),
          completed: false,
          deferred: Boolean(rateLimitUntil),
          reason: rateLimitUntil ? "rate_limit_cooldown" : "project_failed",
          dataset: DATASET,
          projectId: project.projectId,
          rateLimitUntil,
          apiRequests,
          error: rateLimitUntil ? undefined : message,
        }, { status: rateLimitUntil ? 200 : 502 });
      }
    } finally {
      if (project) {
        await prisma.$executeRawUnsafe(
          `UPDATE procore_sync_project_states SET locked_by = NULL, locked_until = NULL, updated_at = NOW()
           WHERE company_id = $1 AND project_id = $2 AND dataset = $3 AND locked_by = $4`,
          companyId,
          project.projectId,
          DATASET,
          worker.leaseId,
        ).catch(() => undefined);
      }
      await releaseProcoreWorker(companyId, worker.leaseId).catch(() => undefined);
    }
  });
}

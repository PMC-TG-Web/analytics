import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { hasValidProcoreSyncSecret, withProcoreLiveApiBypassForSyncSecret } from "@/lib/procore";
import { syncPmDashboardProject } from "@/lib/pmDashboardSync";
import { acquireProcoreWorker, releaseProcoreWorker } from "@/lib/procoreSyncQueue";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_COMPANY_ID = "598134325805519";
// RFIs, Task Items, and Meetings arrive via project webhooks; this sweep is the
// reconciliation safety net, so it no longer needs a 15-minute cadence.
const DEFAULT_REPOLL_MINUTES = 90;

function repollMinutes() {
  const parsed = Number.parseInt(String(process.env.PM_DASHBOARD_REPOLL_MINUTES || ""), 10);
  return Number.isFinite(parsed) && parsed >= 5 ? parsed : DEFAULT_REPOLL_MINUTES;
}

type SyncProjectRow = {
  companyId: string;
  procoreProjectId: string;
  projectName: string;
};

export async function POST(request: NextRequest) {
  if (!hasValidProcoreSyncSecret(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const limit = Math.max(1, Math.min(4, Number.parseInt(String(body.limit || "2"), 10) || 2));
  const companyId = String(body.companyId || process.env.PROCORE_COMPANY_ID || DEFAULT_COMPANY_ID).trim();
  const requestedProjectId = String(body.projectId || "").trim();
  const intervalMinutes = repollMinutes();

  // Share the per-company lease with the other Procore workers so this sweep
  // never runs alongside actuals/change-order syncs or during a cooldown.
  const worker = await acquireProcoreWorker(companyId, 4);
  if (!worker.acquired) {
    return NextResponse.json({
      success: true,
      skipped: true,
      reason: worker.reason,
      rateLimitUntil: worker.control?.rate_limit_until || null,
      workerLockedUntil: worker.control?.worker_locked_until || null,
      scanned: 0,
      failed: 0,
      nextBatch: false,
      results: [],
    });
  }

  try {
  const projects = requestedProjectId
    ? await prisma.$queryRaw<SyncProjectRow[]>`
        SELECT
          p."company_id" AS "companyId",
          p."procore_project_id" AS "procoreProjectId",
          p."project_name" AS "projectName"
        FROM "pmc_projects" p
        WHERE p."company_id" = ${companyId}
          AND p."procore_project_id" = ${requestedProjectId}
        LIMIT 1
      `
    : await prisma.$queryRaw<SyncProjectRow[]>`
        SELECT
          p."company_id" AS "companyId",
          p."procore_project_id" AS "procoreProjectId",
          p."project_name" AS "projectName"
        FROM "pmc_projects" p
        LEFT JOIN "pmc_action_item_sync_state" s
          ON s."company_id" = p."company_id"
         AND s."procore_project_id" = p."procore_project_id"
        WHERE p."company_id" = ${companyId}
          AND lower(COALESCE(p."status", '')) NOT LIKE '%complete%'
          AND lower(COALESCE(p."status", '')) NOT LIKE '%closed%'
          AND lower(COALESCE(p."status", '')) NOT LIKE '%cancel%'
          AND (
            s."last_attempt_at" IS NULL
            OR s."last_attempt_at" < CURRENT_TIMESTAMP - (${intervalMinutes} * INTERVAL '1 minute')
          )
        ORDER BY s."last_attempt_at" ASC NULLS FIRST, p."project_name" ASC
        LIMIT ${limit}
      `;

  const results = [];
  let rateLimited = false;
  for (const project of projects) {
    const result = await withProcoreLiveApiBypassForSyncSecret(request, () => syncPmDashboardProject(project));
    results.push(result);
    if (result.rateLimited) {
      rateLimited = true;
      break;
    }
  }

  const failed = results.filter((result) => !result.success).length;
  return NextResponse.json({
    success: failed === 0,
    scanned: results.length,
    failed,
    rateLimited,
    repollMinutes: intervalMinutes,
    nextBatch: !rateLimited && !requestedProjectId && projects.length === limit,
    results,
  }, { status: failed === 0 ? 200 : 207 });
  } finally {
    await releaseProcoreWorker(companyId, worker.leaseId).catch(() => undefined);
  }
}

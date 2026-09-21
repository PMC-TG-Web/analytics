import { withPmDashboardProcoreConnection } from '@/lib/procoreConnection';
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { hasValidProcoreSyncSecret, withProcoreLiveApiBypassForSyncSecret } from "@/lib/procore";
import { syncPmDashboardProject } from "@/lib/pmDashboardSync";
import { acquireProcoreWorker, releaseProcoreWorker } from "@/lib/procoreSyncQueue";
import { pmDashboardPollingMinutes } from "@/lib/procorePollingPolicy";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_COMPANY_ID = "598134325805519";
// RFIs, Task Items, Meetings, and Change Events arrive via project webhooks; this sweep is the
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
  status?: string | null;
  bidBoardStatus?: string | null;
  lastAttemptAt?: Date | null;
};

async function runSweep(request: NextRequest) {
  if (!hasValidProcoreSyncSecret(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const limit = Math.max(1, Math.min(4, Number.parseInt(String(body.limit || "2"), 10) || 2));
  const companyId = String(body.companyId || process.env.PROCORE_COMPANY_ID || DEFAULT_COMPANY_ID).trim();
  const requestedProjectId = String(body.projectId || "").trim();
  const intervalMinutes = repollMinutes();

  // Coordinate with other workers using this same Procore app and company.
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
  const candidates = requestedProjectId
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
          p."project_name" AS "projectName",
          p."status" AS "status",
          p."bid_board_status" AS "bidBoardStatus",
          s."last_attempt_at" AS "lastAttemptAt"
        FROM "pmc_projects" p
        LEFT JOIN "pmc_action_item_sync_state" s
          ON s."company_id" = p."company_id"
         AND s."procore_project_id" = p."procore_project_id"
        WHERE p."company_id" = ${companyId}
      `;
  const nowMs = Date.now();
  const projects = requestedProjectId ? candidates : candidates
    .map((project) => ({ project, minutes: pmDashboardPollingMinutes(project, intervalMinutes) }))
    .filter((candidate) => candidate.minutes !== null)
    .map(({ project, minutes }) => ({
      project,
      dueAt: project.lastAttemptAt ? project.lastAttemptAt.getTime() + minutes! * 60_000 : 0,
    }))
    .filter(({ dueAt }) => dueAt <= nowMs)
    .sort((a, b) => a.dueAt - b.dueAt || a.project.procoreProjectId.localeCompare(b.project.procoreProjectId))
    .slice(0, limit)
    .map(({ project }) => project);

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

export async function POST(request: NextRequest) {
  if (!hasValidProcoreSyncSecret(request)) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  return withPmDashboardProcoreConnection(() => runSweep(request));
}

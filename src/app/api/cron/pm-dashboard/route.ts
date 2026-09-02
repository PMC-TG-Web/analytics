import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { hasValidProcoreSyncSecret, withProcoreLiveApiBypassForSyncSecret } from "@/lib/procore";
import { syncPmDashboardProject } from "@/lib/pmDashboardSync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_COMPANY_ID = "598134325805519";

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
            OR s."last_attempt_at" < CURRENT_TIMESTAMP - INTERVAL '15 minutes'
          )
        ORDER BY s."last_attempt_at" ASC NULLS FIRST, p."project_name" ASC
        LIMIT ${limit}
      `;

  const results = [];
  for (const project of projects) {
    const result = await withProcoreLiveApiBypassForSyncSecret(request, () => syncPmDashboardProject(project));
    results.push(result);
    if (result.errors.some((entry) => /429|rate limit/i.test(entry.error))) break;
  }

  const failed = results.filter((result) => !result.success).length;
  return NextResponse.json({
    success: failed === 0,
    scanned: results.length,
    failed,
    nextBatch: !requestedProjectId && projects.length === limit,
    results,
  }, { status: failed === 0 ? 200 : 207 });
}

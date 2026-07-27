import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequiredSyncSecret } from "@/lib/cronSync";

export const dynamic = "force-dynamic";

function authorized(request: NextRequest) {
  const provided = request.headers.get("x-sync-secret")?.trim()
    || request.headers.get("x-cron-secret")?.trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const syncSecret = getRequiredSyncSecret();
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return Boolean(provided) && (provided === syncSecret || (!!cronSecret && provided === cronSecret));
}

type StateRow = {
  dataset: string;
  project_count: number;
  never_succeeded: number;
  failed_projects: number;
  due_projects: number;
  oldest_success: Date | null;
  newest_success: Date | null;
  oldest_due: Date | null;
};

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const companyId = String(request.nextUrl.searchParams.get("companyId") || process.env.PROCORE_COMPANY_ID || "").trim();
  const [datasets, staleProjects, control, webhookQueue] = await Promise.all([
    prisma.$queryRawUnsafe<StateRow[]>(
      `
        SELECT
          dataset,
          COUNT(*)::int AS project_count,
          COUNT(*) FILTER (WHERE last_success_at IS NULL)::int AS never_succeeded,
          COUNT(*) FILTER (WHERE failure_count > 0)::int AS failed_projects,
          COUNT(*) FILTER (WHERE next_run_at <= NOW())::int AS due_projects,
          MIN(last_success_at) AS oldest_success,
          MAX(last_success_at) AS newest_success,
          MIN(next_run_at) FILTER (WHERE next_run_at <= NOW()) AS oldest_due
        FROM procore_sync_project_states
        WHERE company_id = $1
        GROUP BY dataset
        ORDER BY dataset
      `,
      companyId
    ),
    prisma.$queryRawUnsafe(
      `
        SELECT project_id, project_number, project_name, dataset, last_success_at,
               next_run_at, failure_count, last_error
        FROM procore_sync_project_states
        WHERE company_id = $1
          AND (
            last_success_at IS NULL
            OR failure_count > 0
            OR (dataset = 'actuals' AND next_run_at < NOW() - INTERVAL '30 minutes')
            OR (dataset = 'actuals_reconciliation' AND next_run_at < NOW() - INTERVAL '6 hours')
            OR (dataset = 'nightly_structure' AND last_success_at < NOW() - INTERVAL '30 hours')
            OR (dataset = 'nightly_bid_board_headers' AND last_success_at < NOW() - INTERVAL '30 hours')
          )
        ORDER BY failure_count DESC, last_success_at NULLS FIRST, project_id
        LIMIT 200
      `,
      companyId
    ),
    prisma.$queryRawUnsafe(
      `SELECT worker_locked_by, worker_locked_until, rate_limit_until, last_429_at, last_error, updated_at FROM procore_sync_controls WHERE company_id = $1`,
      companyId
    ),
    prisma.$queryRawUnsafe(
      `SELECT status, COUNT(*)::int AS count, MIN(available_at) AS oldest_available FROM procore_webhook_queue GROUP BY status ORDER BY status`
    ),
  ]);
  return NextResponse.json({
    success: true,
    companyId,
    generatedAt: new Date().toISOString(),
    datasets,
    staleProjects,
    control: control[0] || null,
    webhookQueue,
  });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequiredSyncSecret } from "@/lib/cronSync";
import { Resend } from "resend";
import {
  evaluateProcoreSyncHealth,
  type ProcoreSyncHealthSnapshot,
} from "@/lib/procoreSyncHealth";

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
  max_failure_count: number;
  due_projects: number;
  oldest_success: Date | null;
  newest_success: Date | null;
  oldest_due: Date | null;
};

async function loadHealth(companyId: string) {
  const [datasets, staleProjects, control, webhookQueue, webhookEvents, projectReconciliation] = await Promise.all([
    prisma.$queryRawUnsafe<StateRow[]>(
      `
        SELECT
          dataset,
          COUNT(*)::int AS project_count,
          COUNT(*) FILTER (WHERE last_success_at IS NULL)::int AS never_succeeded,
          COUNT(*) FILTER (WHERE failure_count > 0)::int AS failed_projects,
          MAX(failure_count)::int AS max_failure_count,
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
            OR (dataset = 'nightly_bid_board_headers' AND last_success_at < NOW() - INTERVAL '1 hour')
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
    prisma.$queryRawUnsafe<Array<{ last_received_at: Date | null }>>(
      `SELECT MAX(received_at) AS last_received_at FROM procore_webhook_events`
    ),
    prisma.$queryRawUnsafe<Array<{ last_success_at: Date | null; last_attempt_at: Date | null }>>(
      `
        SELECT
          MAX(started_at) FILTER (WHERE success = TRUE AND finished_at IS NOT NULL) AS last_success_at,
          MAX(started_at) AS last_attempt_at
        FROM sync_logs
        WHERE company_id = $1
          AND triggered_by = 'project-reconciliation'
      `,
      companyId
    ),
  ]);
  return {
    companyId,
    generatedAt: new Date().toISOString(),
    datasets,
    staleProjects,
    control: control[0] || null,
    webhookQueue,
    lastWebhookReceivedAt: webhookEvents[0]?.last_received_at || null,
    projectReconciliation: projectReconciliation[0] || null,
  };
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const companyId = String(request.nextUrl.searchParams.get("companyId") || process.env.PROCORE_COMPANY_ID || "").trim();
  return NextResponse.json({ success: true, ...await loadHealth(companyId) });
}

function alertRecipients() {
  return [...new Set(
    String(process.env.SYNC_HEALTH_ALERT_TO_EMAILS || "todd@pmcdecor.com")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )];
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const companyId = String(process.env.PROCORE_COMPANY_ID || "").trim();
  const health = await loadHealth(companyId);
  const issues = evaluateProcoreSyncHealth(health as ProcoreSyncHealthSnapshot);
  if (issues.length === 0) {
    return NextResponse.json({ success: true, healthy: true, alerted: false, health });
  }

  const fingerprint = issues.slice().sort().join("\n").slice(0, 4_000);
  const recentAlert = await prisma.syncLog.findFirst({
    where: {
      companyId,
      triggeredBy: "sync-health-alert",
      success: true,
      error: fingerprint,
      startedAt: { gte: new Date(Date.now() - 6 * 60 * 60_000) },
    },
    select: { id: true, startedAt: true },
  });
  if (recentAlert) {
    return NextResponse.json({
      success: true,
      healthy: false,
      alerted: false,
      reason: "duplicate-alert-suppressed",
      issues,
      previousAlertAt: recentAlert.startedAt,
    });
  }

  const log = await prisma.syncLog.create({
    data: {
      companyId,
      triggeredBy: "sync-health-alert",
      steps: issues.map((issue) => ({ step: "health-check", status: "error", detail: issue })),
      error: fingerprint,
    },
    select: { id: true },
  });

  try {
    const apiKey = String(process.env.RESEND_API_KEY || "").trim();
    if (!apiKey) throw new Error("RESEND_API_KEY is not configured.");
    const from = String(
      process.env.SYNC_HEALTH_ALERT_FROM_EMAIL
      || process.env.RESEND_FROM_EMAIL
      || "Analytics Automation <notifications@pmcdecor.com>",
    ).trim();
    const result = await new Resend(apiKey).emails.send({
      from,
      to: alertRecipients(),
      subject: `[Analytics] Production sync needs attention (${issues.length})`,
      text: `Analytics detected the following automation problems:\n\n- ${issues.join("\n- ")}\n\nDetected ${health.generatedAt}.`,
      html: `<p>Analytics detected the following automation problems:</p><ul>${issues
        .map((issue) => `<li>${escapeHtml(issue)}</li>`)
        .join("")}</ul><p>Detected ${escapeHtml(health.generatedAt)}.</p>`,
    });
    if (result.error) throw new Error(result.error.message);
    await prisma.syncLog.update({
      where: { id: log.id },
      data: { finishedAt: new Date(), success: true, totalMs: 0 },
    });
    return NextResponse.json({ success: true, healthy: false, alerted: true, issues });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.update({
      where: { id: log.id },
      data: { finishedAt: new Date(), success: false, error: `${fingerprint}\nAlert delivery: ${message}`.slice(0, 4_000) },
    }).catch(() => undefined);
    return NextResponse.json({ success: false, healthy: false, alerted: false, issues, error: message }, { status: 503 });
  }
}

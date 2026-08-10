import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequiredSyncSecret } from "@/lib/cronSync";
import { procoreSyncDetailHasErrors } from "@/lib/procoreSyncResponse";

export const dynamic = "force-dynamic";
export const maxDuration = 800;

function authorized(request: NextRequest) {
  const provided = request.headers.get("x-sync-secret")?.trim()
    || request.headers.get("x-cron-secret")?.trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const syncSecret = getRequiredSyncSecret();
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return Boolean(provided) && (provided === syncSecret || (!!cronSecret && provided === cronSecret));
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const syncSecret = getRequiredSyncSecret();
  if (!syncSecret) {
    return NextResponse.json({ success: false, error: "PROCORE_SYNC_SECRET is not configured" }, { status: 503 });
  }

  const startedAt = Date.now();
  const companyId = String(process.env.PROCORE_COMPANY_ID || "598134325805519").trim();
  const log = await prisma.syncLog.create({
    data: { companyId, triggeredBy: "project-reconciliation", steps: [] },
    select: { id: true },
  });

  try {
    const response = await fetch(`${request.nextUrl.origin}/api/procore/sync/all-projects`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-secret": syncSecret },
      body: JSON.stringify({
        companyId,
        fetchAll: true,
        forceUserOAuth: false,
        includeInactiveV1: false,
        includeTestProjects: false,
        maxPages: 200,
      }),
      signal: AbortSignal.timeout(12 * 60_000),
    });
    const detail = await response.json().catch(() => null);
    const summary = detail && typeof detail === "object" && !Array.isArray(detail)
      ? (detail as Record<string, unknown>).summary
      : null;
    const success = response.ok && !procoreSyncDetailHasErrors(detail) && !procoreSyncDetailHasErrors(summary);
    const error = success
      ? null
      : JSON.stringify(detail || `Project reconciliation returned HTTP ${response.status}`).slice(0, 4_000);
    const totalMs = Date.now() - startedAt;

    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        finishedAt: new Date(),
        success,
        totalMs,
        steps: [{ step: "all-active-projects", status: success ? "ok" : "error", httpStatus: response.status }],
        error,
      },
    });

    return NextResponse.json({
      success,
      companyId,
      logId: log.id.toString(),
      totalMs,
      detail,
    }, { status: success ? 200 : 207 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.syncLog.update({
      where: { id: log.id },
      data: {
        finishedAt: new Date(),
        success: false,
        totalMs: Date.now() - startedAt,
        error: message.slice(0, 4_000),
      },
    }).catch(() => undefined);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

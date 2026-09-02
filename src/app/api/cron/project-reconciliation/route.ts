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

async function runProjectReconciliation(request: NextRequest, syncSecret: string) {
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
    const apiRequests = Number.parseInt(response.headers.get("x-procore-api-request-count") || "0", 10) || 0;
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
        steps: [{ step: "all-active-projects", status: success ? "ok" : "error", httpStatus: response.status, apiRequests }],
        error,
      },
    });

    return {
      success,
      companyId,
      logId: log.id.toString(),
      totalMs,
      apiRequests,
      detail,
    };
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
    return { success: false, error: message };
  }
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const syncSecret = getRequiredSyncSecret();
  if (!syncSecret) {
    return NextResponse.json({ success: false, error: "PROCORE_SYNC_SECRET is not configured" }, { status: 503 });
  }

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  const whitespace = `${" ".repeat(2_048)}\n`;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(whitespace));
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(whitespace));
        } catch {
          if (heartbeat) clearInterval(heartbeat);
        }
      }, 8_000);

      void runProjectReconciliation(request, syncSecret)
        .then((result) => controller.enqueue(encoder.encode(JSON.stringify(result))))
        .catch((error) => controller.enqueue(encoder.encode(JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }))))
        .finally(() => {
          if (heartbeat) clearInterval(heartbeat);
          controller.close();
        });
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * POST /api/cron/sync
 *
 * Orchestrates a full Procore data sync in sequence:
 *   1. projects (all-projects feed)
 *   2. bids (bid board)
 *   3. budget line items
 *   4. commitment contracts
 *   5. timecard entries
 *   6. refresh materialized views (bid_board_latest_mv, budget_agg_mv, commitments_agg_mv)
 *
 * Protected by the CRON_SECRET environment variable via the `x-cron-secret` header.
 * Netlify scheduled functions call this endpoint every 15 minutes.
 */

export const dynamic = "force-dynamic";

// Allow up to 5 minutes for the full sync on supported plans.
export const maxDuration = 300;

const SYNC_STEPS = [
  {
    name: "projects",
    path: "/api/procore/sync/all-projects",
    body: {
      fetchAll: true,
      forceUserOAuth: false,
      maxPages: 200,
      includeInactiveV1: false,
      includeTestProjects: false,
    },
  },
  {
    name: "bids",
    path: "/api/procore/sync/bids",
    body: {
      companyWide: true,
      fetchAll: true,
      forceUserOAuth: false,
      limitProjects: 1000,
    },
  },
  {
    name: "budget-line-items",
    path: "/api/procore/sync/budget-line-items",
    body: {
      forceUserOAuth: false,
      fetchAll: true,
    },
  },
  {
    name: "commitment-contracts",
    path: "/api/procore/sync/commitment-contracts",
    body: {
      forceUserOAuth: false,
      fetchAll: true,
    },
  },
  {
    name: "timecard-entries",
    path: "/api/procore/sync/timecard-entries",
    body: {
      forceUserOAuth: false,
      fetchAll: true,
    },
  },
  {
    name: "productivity-logs",
    path: "/api/procore/sync/productivity-projects",
    body: {
      forceUserOAuth: false,
      persist: true,
    },
  },
];

const MATERIALIZED_VIEWS = [
  "bid_board_latest_mv",
  "budget_agg_mv",
  "commitments_agg_mv",
];

async function refreshMaterializedViews(): Promise<Record<string, string>> {
  const results: Record<string, string> = {};
  for (const view of MATERIALIZED_VIEWS) {
    try {
      await prisma.$executeRawUnsafe(
        `REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`
      );
      results[view] = "refreshed";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // View may not exist in all environments — log but don't fail the cron job.
      if (msg.includes("does not exist") || msg.includes("undefined_table")) {
        results[view] = "skipped (view not found)";
      } else {
        results[view] = `error: ${msg}`;
      }
    }
  }
  return results;
}

export async function POST(request: NextRequest) {
  // ── Auth check ─────────────────────────────────────────────────────────────
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const provided = request.headers.get("x-cron-secret");
    if (provided !== cronSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const body = await request.json().catch(() => ({}));
  const companyId = String(
    body?.companyId ||
      process.env.PROCORE_COMPANY_ID ||
      process.env.NEXT_PUBLIC_PROCORE_COMPANY_ID ||
      ""
  ).trim();
  const triggeredBy: string = body?.triggeredBy === "manual" ? "manual" : "cron";

  if (!companyId) {
    return NextResponse.json(
      { error: "MISSING_COMPANY_ID: Set PROCORE_COMPANY_ID in environment." },
      { status: 400 }
    );
  }

  // ── Create a pending log entry ─────────────────────────────────────────────
  let logId: bigint | null = null;
  try {
    const log = await prisma.syncLog.create({
      data: { companyId, triggeredBy },
      select: { id: true },
    });
    logId = log.id;
  } catch (err) {
    // Don't block the sync if logging fails
    console.error("[cron/sync] Failed to create log entry:", err);
  }

  const origin = request.nextUrl.origin;
  const syncSecret = (
    process.env.PROCORE_SYNC_SECRET || process.env.SYNC_SECRET || ""
  ).trim();
  const startTime = Date.now();
  const stepResults: Array<{
    step: string;
    status: "ok" | "error" | "skipped";
    durationMs: number;
    detail?: unknown;
  }> = [];

  // ── Run each sync step ─────────────────────────────────────────────────────
  for (const step of SYNC_STEPS) {
    const stepStart = Date.now();
    try {
      const res = await fetch(`${origin}${step.path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(syncSecret ? { "x-sync-secret": syncSecret } : {}),
        },
        body: JSON.stringify({ ...step.body, companyId }),
      });

      const json = await res.json().catch(() => null);
      stepResults.push({
        step: step.name,
        status: res.ok ? "ok" : "error",
        durationMs: Date.now() - stepStart,
        detail: res.ok ? undefined : json,
      });

      if (!res.ok) {
        console.error(
          `[cron/sync] Step "${step.name}" failed (${res.status}):`,
          json
        );
      }
    } catch (err) {
      stepResults.push({
        step: step.name,
        status: "error",
        durationMs: Date.now() - stepStart,
        detail: err instanceof Error ? err.message : String(err),
      });
      console.error(`[cron/sync] Step "${step.name}" threw:`, err);
    }
  }

  // ── Refresh materialized views ─────────────────────────────────────────────
  const mvStart = Date.now();
  let mvResults: Record<string, string> = {};
  try {
    mvResults = await refreshMaterializedViews();
  } catch (err) {
    console.error("[cron/sync] MV refresh error:", err);
  }

  const totalMs = Date.now() - startTime;
  const hasErrors = stepResults.some((s) => s.status === "error");
  const mvDurationMs = Date.now() - mvStart;

  // ── Finalize log entry ─────────────────────────────────────────────────────
  if (logId !== null) {
    try {
      await prisma.syncLog.update({
        where: { id: logId },
        data: {
          finishedAt: new Date(),
          success: !hasErrors,
          totalMs,
          steps: stepResults as object[],
          mvResults: mvResults as object,
        },
      });
    } catch (err) {
      console.error("[cron/sync] Failed to update log entry:", err);
    }
  }

  return NextResponse.json(
    {
      success: !hasErrors,
      totalDurationMs: totalMs,
      companyId,
      logId: logId?.toString() ?? null,
      steps: stepResults,
      materializedViews: {
        durationMs: mvDurationMs,
        results: mvResults,
      },
    },
    { status: hasErrors ? 207 : 200 }
  );
}

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

function toDateKey(date: Date): string {
  return date.toISOString().split("T")[0];
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function buildSyncSteps(options: { startDate: string; endDate: string; maxProjects: number }) {
  const { startDate, endDate, maxProjects } = options;
  return [
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
        startDate,
        endDate,
        perPage: 50,
        concurrency: 1,
        ...(maxProjects > 0 ? { maxProjects } : {}),
      },
    },
    {
      name: "productivity-logs",
      path: "/api/procore/sync/productivity-projects",
      body: {
        forceUserOAuth: false,
        persist: true,
        startDate,
        endDate,
        perPage: 50,
        concurrency: 1,
        ...(maxProjects > 0 ? { maxProjects } : {}),
      },
    },
  ];
}

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
    console.error("[cron/sync] Failed to create log entry:", err);
  }

  const origin = request.nextUrl.origin;
  const syncSecret = (
    process.env.PROCORE_SYNC_SECRET || process.env.SYNC_SECRET || ""
  ).trim();
  const startTime = Date.now();
  const lookbackDays = Math.min(
    120,
    Math.max(7, parsePositiveInt(process.env.PROCORE_SYNC_LOOKBACK_DAYS, 30))
  );
  const maxProjects = Math.max(0, parsePositiveInt(process.env.PROCORE_SYNC_MAX_PROJECTS, 0));
  const endDate = toDateKey(new Date());
  const startDate = toDateKey(new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000));
  const syncSteps = buildSyncSteps({ startDate, endDate, maxProjects });

  // ── Fire all sync steps concurrently (fire-and-forget per step) ───────────
  // Netlify has a 30-second gateway timeout on API routes, so we cannot await
  // all steps sequentially. Instead we fire every step without awaiting, log
  // the dispatch to the DB, and return 202 immediately. Each step writes its
  // own result to the DB. MV refresh is best-effort after a short delay.
  const stepPromises = syncSteps.map((step) =>
    fetch(`${origin}${step.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(syncSecret ? { "x-sync-secret": syncSecret } : {}),
      },
      body: JSON.stringify({ ...step.body, companyId }),
    })
      .then(async (res) => {
        const detail = res.ok ? undefined : await res.json().catch(() => null);
        if (!res.ok) console.error(`[cron/sync] Step "${step.name}" failed (${res.status}):`, detail);
        return { step: step.name, status: res.ok ? "ok" : "error", httpStatus: res.status } as const;
      })
      .catch((err) => {
        console.error(`[cron/sync] Step "${step.name}" threw:`, err);
        return { step: step.name, status: "error" as const, httpStatus: 0 };
      })
  );

  // Update log as dispatched — don't wait for completion
  if (logId !== null) {
    prisma.syncLog.update({
      where: { id: logId },
      data: {
          steps: syncSteps.map((s) => ({ step: s.name, status: "dispatched" })) as object[],
      },
    }).catch(() => {});
  }

  // Best-effort: wait for steps and MV refresh in the background, update log
  // when done. This may be cut off by the gateway — that's acceptable.
  Promise.allSettled(stepPromises).then(async (settled) => {
    const stepResults = settled.map((r) =>
      r.status === "fulfilled" ? r.value : { step: "unknown", status: "error" as const, httpStatus: 0 }
    );
    const mvResults = await refreshMaterializedViews().catch(() => ({}));
    const totalMs = Date.now() - startTime;
    const hasErrors = stepResults.some((s) => s.status === "error");
    if (logId !== null) {
      prisma.syncLog.update({
        where: { id: logId },
        data: {
          finishedAt: new Date(),
          success: !hasErrors,
          totalMs,
          steps: stepResults as object[],
          mvResults: mvResults as object,
        },
      }).catch(() => {});
    }
  });

  return NextResponse.json(
    {
      success: true,
      accepted: true,
      companyId,
      logId: logId?.toString() ?? null,
      stepsDispatched: syncSteps.map((s) => s.name),
      syncWindow: { startDate, endDate, lookbackDays, maxProjects },
      note: "Sync steps dispatched concurrently. Check sync_logs for results.",
    },
    { status: 202 }
  );
}

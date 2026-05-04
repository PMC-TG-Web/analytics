import { prisma } from "@/lib/prisma";

const DEBOUNCE_SECONDS = 120;
const VIEW_NAME = "commitments_agg_mv";

function isMissingRelationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("does not exist") || message.includes("undefined_table");
}

/**
 * Returns true if the MV was refreshed within the debounce window and the
 * refresh should be skipped. Uses an atomic upsert so only one serverless
 * invocation wins the window even under concurrent requests.
 */
async function acquireRefreshSlot(): Promise<boolean> {
  try {
    // Atomically claim the refresh slot. If the row doesn't exist, or the last
    // refresh was more than DEBOUNCE_SECONDS ago, update and return the old
    // refreshed_at so the caller knows whether to proceed.
    type SlotRow = { previous_refreshed_at: Date | null };
    const rows = await prisma.$queryRawUnsafe<SlotRow[]>(
      `INSERT INTO mv_refresh_tracking (view_name, refreshed_at)
       VALUES ($1, NOW())
       ON CONFLICT (view_name) DO UPDATE
         SET refreshed_at = NOW()
         WHERE mv_refresh_tracking.refreshed_at < NOW() - ($2 || ' seconds')::interval
       RETURNING (
         SELECT refreshed_at FROM mv_refresh_tracking
         WHERE view_name = $1
       ) AS previous_refreshed_at`,
      VIEW_NAME,
      DEBOUNCE_SECONDS
    );

    // If no row was returned the ON CONFLICT WHERE clause didn't match —
    // meaning another invocation refreshed within the window. Skip.
    return rows.length > 0;
  } catch (error) {
    // If the tracking table doesn't exist yet, proceed with the refresh anyway.
    if (isMissingRelationError(error)) return true;
    console.error("[commitmentsAggMv] acquireRefreshSlot error:", error);
    return true; // fail open — better to refresh than to never refresh
  }
}

export async function refreshCommitmentsAggMaterializedView(): Promise<void> {
  const shouldRefresh = await acquireRefreshSlot();
  if (!shouldRefresh) return;

  try {
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${VIEW_NAME}`);
    return;
  } catch (error) {
    // Fallback for environments where concurrent refresh cannot run.
    if (isMissingRelationError(error)) return;
  }

  try {
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW ${VIEW_NAME}`);
  } catch (error) {
    if (!isMissingRelationError(error)) {
      console.error("[commitmentsAggMv] refresh failed:", error);
    }
  }
}

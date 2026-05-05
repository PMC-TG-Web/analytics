import type { Config } from "@netlify/functions";

/**
 * Netlify Scheduled Function — runs every 15 minutes.
 *
 * Calls the internal /api/cron/sync endpoint which orchestrates:
 *   - Procore projects feed sync
 *   - Bids / bid-board sync
 *   - Budget line items sync
 *   - Commitment contracts sync
 *   - Timecard entries sync
 *   - Materialized view refresh (bid_board_latest_mv, budget_agg_mv, commitments_agg_mv)
 *
 * Required environment variables (set in Netlify UI):
 *   CRON_SECRET         — shared secret verified by /api/cron/sync
 *   PROCORE_COMPANY_ID  — Procore company ID to sync
 *   URL                 — automatically set by Netlify to the site's primary URL
 */
const handler = async () => {
  const secret = process.env.CRON_SECRET ?? "";
  const companyId = process.env.PROCORE_COMPANY_ID ?? "";
  // Netlify sets URL to the deploy's primary URL. Fall back to APP_BASE_URL.
  const baseUrl = (
    process.env.URL ||
    process.env.APP_BASE_URL ||
    ""
  ).replace(/\/$/, "");

  if (!baseUrl) {
    console.error("[scheduled-sync] No base URL configured. Set URL or APP_BASE_URL.");
    return new Response("No base URL", { status: 500 });
  }

  const endpoint = `${baseUrl}/api/cron/sync`;
  console.log(`[scheduled-sync] Triggering sync → ${endpoint}`);

  let responseStatus = 0;
  let responseBody: unknown = null;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": secret,
      },
      body: JSON.stringify({ companyId }),
    });

    responseStatus = res.status;
    responseBody = await res.json().catch(() => null);

    if (!res.ok && res.status !== 207) {
      console.error(
        `[scheduled-sync] Sync endpoint returned ${res.status}:`,
        JSON.stringify(responseBody)
      );
      return new Response(JSON.stringify({ error: "Sync failed", status: res.status }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = responseBody as Record<string, unknown> | null;
    console.log(
      `[scheduled-sync] Sync complete — status=${responseStatus} totalMs=${body?.totalDurationMs ?? "?"} success=${body?.success}`
    );

    return new Response(JSON.stringify({ ok: true, syncStatus: responseStatus, body: responseBody }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[scheduled-sync] Fetch error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export default handler;

export const config: Config = {
  // Every 15 minutes
  schedule: "*/15 * * * *",
};

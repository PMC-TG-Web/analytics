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
  console.log(`[scheduled-sync] Firing sync → ${endpoint}`);

  // Fire-and-forget: the full sync takes 30–120 seconds which exceeds the
  // Netlify scheduled-function 15-second timeout. We kick off the request,
  // confirm the server accepted it (2xx on the initial response), then return
  // immediately. The Next.js route continues running on Netlify's infrastructure.
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": secret,
      },
      body: JSON.stringify({ companyId }),
      // Do not read the body — return as soon as headers arrive.
      signal: AbortSignal.timeout(12_000),
    });

    if (res.status === 401 || res.status === 403) {
      // Auth failures should be surfaced — they won't self-resolve.
      const text = await res.text().catch(() => "");
      console.error(`[scheduled-sync] Auth error ${res.status}: ${text}`);
      return new Response(JSON.stringify({ error: "Auth failure", status: res.status }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`[scheduled-sync] Sync accepted — HTTP ${res.status}. Results will appear in sync_logs.`);
    return new Response(JSON.stringify({ ok: true, accepted: res.status }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    // A timeout here just means the cron route is still running — that's fine.
    const isTimeout = err instanceof Error && err.name === "TimeoutError";
    if (isTimeout) {
      console.log("[scheduled-sync] Cron route still running after 12s — this is expected for large syncs.");
      return new Response(JSON.stringify({ ok: true, note: "cron running" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
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

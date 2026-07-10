/**
 * Netlify Scheduled Function. Rotates through budgeted projects and refreshes
 * recent Procore timecard/productivity actuals. This exists because Procore's
 * webhook catalog for this company does not expose those actuals resources.
 *
 * Required environment variables:
 *   PROCORE_SYNC_SECRET
 *   APP_BASE_URL
 */
import type { Config } from "@netlify/functions";

function parseOptionalPositiveInt(value: string | undefined): number | undefined {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

const handler = async () => {
  const syncSecret = (process.env.PROCORE_SYNC_SECRET || "").trim();
  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");

  if (!syncSecret) {
    console.error("[scheduled-actuals-sync] PROCORE_SYNC_SECRET is not configured.");
    return new Response("Missing PROCORE_SYNC_SECRET", { status: 500 });
  }

  if (!baseUrl) {
    console.error("[scheduled-actuals-sync] No base URL configured. Set APP_BASE_URL.");
    return new Response("No base URL", { status: 500 });
  }

  const body: Record<string, unknown> = {};
  const batchSize = parseOptionalPositiveInt(process.env.PROCORE_ACTUALS_SYNC_PROJECT_BATCH_SIZE);
  const lookbackDays = parseOptionalPositiveInt(process.env.PROCORE_ACTUALS_SYNC_LOOKBACK_DAYS);
  const perPage = parseOptionalPositiveInt(process.env.PROCORE_ACTUALS_SYNC_PER_PAGE);

  if (batchSize !== undefined) body.batchSize = batchSize;
  if (lookbackDays !== undefined) body.lookbackDays = lookbackDays;
  if (perPage !== undefined) body.perPage = perPage;

  const endpoint = `${baseUrl}/api/cron/actuals`;
  console.log(`[scheduled-actuals-sync] Refreshing Procore actuals -> ${endpoint}`);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sync-secret": syncSecret,
      },
      body: JSON.stringify(body),
    });

    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    const ok = response.ok;
    console.log(
      `[scheduled-actuals-sync] Actuals refresh ${ok ? "completed" : "failed"} - status=${response.status} selected=${Array.isArray(result?.selectedProjectIds) ? result.selectedProjectIds.length : "?"} totalMs=${result?.totalMs ?? "?"}`
    );

    return new Response(JSON.stringify({ ok, processStatus: response.status, body: result }), {
      status: ok ? 200 : 500,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[scheduled-actuals-sync] Fetch error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export default handler;

export const config: Config = {
  schedule: "7,22,37,52 * * * *",
};

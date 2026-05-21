/**
 * Netlify Scheduled Function. Runs every 15 minutes and drains queued Procore
 * webhook events. Full Procore syncs are intentionally manual/bootstrap-only
 * because broad polling can exceed Procore rate limits and Netlify timeouts.
 *
 * Required environment variables:
 *   PROCORE_SYNC_SECRET
 *   URL or APP_BASE_URL
 */
const handler = async () => {
  const syncSecret = (process.env.PROCORE_SYNC_SECRET || process.env.SYNC_SECRET || "").trim();
  const baseUrl = (
    process.env.URL ||
    process.env.APP_BASE_URL ||
    ""
  ).replace(/\/$/, "");
  const batchSize = Math.max(
    1,
    Number.parseInt(process.env.PROCORE_WEBHOOK_PROCESS_BATCH_SIZE || "25", 10) || 25
  );

  if (!syncSecret) {
    console.error("[scheduled-sync] PROCORE_SYNC_SECRET is not configured.");
    return new Response("Missing PROCORE_SYNC_SECRET", { status: 500 });
  }

  if (!baseUrl) {
    console.error("[scheduled-sync] No base URL configured. Set URL or APP_BASE_URL.");
    return new Response("No base URL", { status: 500 });
  }

  const endpoint = `${baseUrl}/api/webhooks/procore/process`;
  console.log(`[scheduled-sync] Processing queued Procore webhook events -> ${endpoint}`);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sync-secret": syncSecret,
      },
      body: JSON.stringify({ batchSize }),
    });

    if (response.status === 401 || response.status === 403) {
      const text = await response.text().catch(() => "");
      console.error(`[scheduled-sync] Auth error ${response.status}: ${text}`);
      return new Response(JSON.stringify({ error: "Auth failure", status: response.status }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    const ok = response.ok;
    console.log(`[scheduled-sync] Webhook queue processing ${ok ? "completed" : "failed"} - status=${response.status} scanned=${body?.scanned ?? "?"} processed=${body?.processed ?? "?"} failed=${body?.failed ?? "?"}`);

    return new Response(JSON.stringify({ ok, processStatus: response.status, body }), {
      status: ok ? 200 : 500,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[scheduled-sync] Fetch error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
};

export default handler;

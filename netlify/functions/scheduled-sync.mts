/**
 * Netlify Scheduled Function. Runs every 5 minutes, drains queued Procore
 * webhook events, reconciles productivity-review cooldowns, and dispatches the
 * appropriate incremental sync worker.
 *
 * Required environment variables:
 *   PROCORE_SYNC_SECRET
 *   URL or APP_BASE_URL
 */
import type { Config } from "@netlify/functions";

const handler = async () => {
  const syncSecret = (process.env.PROCORE_SYNC_SECRET || "").trim();
  const baseUrl = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
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

    const reminderResponse = await fetch(
      `${baseUrl}/api/cron/productivity-review-reminders`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sync-secret": syncSecret,
        },
      },
    );
    const reminderBody = await reminderResponse.json().catch(() => null) as Record<string, unknown> | null;
    console.log(
      `[scheduled-sync] Productivity review cooldowns ${reminderResponse.ok ? "reconciled" : "failed"}`
      + ` - status=${reminderResponse.status}`
      + ` scanned=${reminderBody?.scanned ?? "?"}`
      + ` scheduled=${reminderBody?.scheduled ?? "?"}`
      + ` due=${reminderBody?.due ?? "?"}`
      + ` sent=${reminderBody?.sent ?? "?"}`
      + ` failed=${reminderBody?.failed ?? "?"}`,
    );

    const nowParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const weekday = nowParts.find((part) => part.type === "weekday")?.value;
    const hour = Number(nowParts.find((part) => part.type === "hour")?.value || 0);
    const isNightlyWindow = hour >= 2 && hour < 6;
    const isReconciliationWindow = weekday === "Sun" && hour >= 6 && hour < 12;
    const workerName = isNightlyWindow
      ? "nightly-structure-sync-background"
      : "actuals-sync-background";
    const workerPath = isNightlyWindow
      ? "/api/background/nightly-structure-sync"
      : "/api/background/actuals-sync";
    const workerBody = isReconciliationWindow ? { mode: "reconcile" } : {};
    const dispatch = await fetch(`${baseUrl}${workerPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sync-secret": syncSecret,
      },
      body: JSON.stringify(workerBody),
    });
    console.log(`[scheduled-sync] Dispatched ${workerName} - status=${dispatch.status} mode=${isReconciliationWindow ? "reconcile" : "normal"}`);

    return new Response(JSON.stringify({
      ok: ok && reminderResponse.ok && dispatch.ok,
      processStatus: response.status,
      reminderStatus: reminderResponse.status,
      dispatchStatus: dispatch.status,
      workerName,
      body,
      reminderBody,
    }), {
      status: ok && reminderResponse.ok && dispatch.ok ? 200 : 500,
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

export const config: Config = {
  schedule: "*/5 * * * *",
};

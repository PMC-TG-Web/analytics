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
import { procoreAutomationCadence } from "../../src/lib/procoreAutomationCadence.js";

const handler = async () => {
  const syncSecret = (process.env.PROCORE_SYNC_SECRET || "").trim();
  const baseUrl = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const batchSize = Math.max(
    1,
    Number.parseInt(process.env.PROCORE_WEBHOOK_PROCESS_BATCH_SIZE || "25", 10) || 25
  );
  const actualsPaused = ["true", "1", "yes"].includes(
    String(process.env.PROCORE_ACTUALS_SYNC_PAUSED || "").trim().toLowerCase(),
  );
  const cadence = procoreAutomationCadence();

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
      + ` failed=${reminderBody?.failed ?? "?"}`
      + ` completeDue=${reminderBody?.completionNoticesDue ?? "?"}`
      + ` completeSent=${reminderBody?.completionNoticesSent ?? "?"}`
      + ` completeFailed=${reminderBody?.completionNoticesFailed ?? "?"}`,
    );

    const timecardNotificationResponse = await fetch(
      `${baseUrl}/api/cron/timecard-notifications`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sync-secret": syncSecret,
        },
      },
    );
    const timecardNotificationBody = await timecardNotificationResponse.json().catch(() => null) as Record<string, unknown> | null;
    console.log(
      `[scheduled-sync] Timecard notifications ${timecardNotificationResponse.ok ? "processed" : "failed"}`
      + ` - status=${timecardNotificationResponse.status}`
      + ` scanned=${timecardNotificationBody?.scanned ?? "?"}`
      + ` sent=${timecardNotificationBody?.sent ?? "?"}`
      + ` retried=${timecardNotificationBody?.retried ?? "?"}`
      + ` failed=${timecardNotificationBody?.failed ?? "?"}`,
    );

    let healthStatus: number | null = null;
    let healthBody: Record<string, unknown> | null = null;
    if (cadence.runHealthMonitor) {
      const healthResponse = await fetch(`${baseUrl}/api/cron/sync/health`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sync-secret": syncSecret,
        },
        body: "{}",
      });
      healthStatus = healthResponse.status;
      healthBody = await healthResponse.json().catch(() => null) as Record<string, unknown> | null;
      console.log(JSON.stringify({
        event: "sync-health-monitor",
        status: healthStatus,
        healthy: healthBody?.healthy,
        alerted: healthBody?.alerted,
        issues: healthBody?.issues,
      }));
    }

    let reconciliationStatus: number | null = null;
    if (cadence.runProjectReconciliation) {
      const reconciliationResponse = await fetch(`${baseUrl}/api/background/project-reconciliation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sync-secret": syncSecret,
        },
        body: "{}",
      });
      reconciliationStatus = reconciliationResponse.status;
      console.log(JSON.stringify({
        event: "project-reconciliation-dispatch",
        status: reconciliationStatus,
      }));
    }

    const nowParts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number(nowParts.find((part) => part.type === "hour")?.value || 0);
    const isNightlyWindow = hour >= 2 && hour < 6;
    const useNightlyWorker = isNightlyWindow && !cadence.runActualsReconciliation;
    const workerName = useNightlyWorker
      ? "nightly-structure-sync-background"
      : "actuals-sync-background";
    const workerPath = useNightlyWorker
      ? "/api/background/nightly-structure-sync"
      : "/api/background/actuals-sync";
    const workerBody = cadence.runActualsReconciliation ? { mode: "reconcile" } : {};
    const skipActualsDispatch = cadence.runProjectReconciliation
      || (actualsPaused && workerName === "actuals-sync-background");
    const dispatch = skipActualsDispatch
      ? new Response(null, { status: 204 })
      : await fetch(`${baseUrl}${workerPath}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-sync-secret": syncSecret,
          },
          body: JSON.stringify(workerBody),
        });
    console.log(
      skipActualsDispatch
        ? cadence.runProjectReconciliation
          ? `[scheduled-sync] Skipped ${workerName} while full project reconciliation was dispatched.`
          : `[scheduled-sync] Skipped ${workerName} because PROCORE_ACTUALS_SYNC_PAUSED is enabled.`
        : `[scheduled-sync] Dispatched ${workerName} - status=${dispatch.status} mode=${cadence.runActualsReconciliation ? "reconcile" : "normal"}`,
    );

    const healthOk = healthStatus == null || (healthStatus >= 200 && healthStatus < 300);
    const reconciliationOk = reconciliationStatus == null
      || (reconciliationStatus >= 200 && reconciliationStatus < 300);

    return new Response(JSON.stringify({
      ok: ok && reminderResponse.ok && timecardNotificationResponse.ok && dispatch.ok && healthOk && reconciliationOk,
      processStatus: response.status,
      reminderStatus: reminderResponse.status,
      timecardNotificationStatus: timecardNotificationResponse.status,
      dispatchStatus: dispatch.status,
      healthStatus,
      reconciliationStatus,
      workerName,
      actualsPaused,
      cadence,
      body,
      reminderBody,
      healthBody,
      timecardNotificationBody,
    }), {
      status: ok && reminderResponse.ok && timecardNotificationResponse.ok && dispatch.ok && healthOk && reconciliationOk ? 200 : 500,
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

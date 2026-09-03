import type { Config } from "@netlify/functions";

/**
 * Drains due Outlook calendar syncs in bounded batches. Dispatched by
 * scheduled-sync every five minutes; each mailbox is re-synced only when its
 * MS_CALENDAR_REPOLL_MINUTES interval has elapsed, so most ticks are cheap.
 */
const handler = async (request: Request) => {
  const expected = (process.env.PROCORE_SYNC_SECRET || "").trim();
  const provided = request.headers.get("x-sync-secret")?.trim() || "";
  if (!expected || provided !== expected) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  const deadline = Date.now() + 8 * 60_000;
  let scanned = 0;
  let synced = 0;
  let accessDenied = 0;
  let failed = 0;
  let configured = true;
  const errors: unknown[] = [];

  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/cron/calendar-sync`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-secret": expected },
      body: JSON.stringify({ limit: 5 }),
      signal: AbortSignal.timeout(2 * 60_000),
    });
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    scanned += Number(result?.scanned || 0);
    synced += Number(result?.synced || 0);
    accessDenied += Number(result?.accessDenied || 0);
    failed += Number(result?.failed || 0);
    if (result?.configured === false) { configured = false; break; }
    if (!response.ok && response.status !== 207) {
      errors.push(result?.error || `calendar sync returned ${response.status}`);
      break;
    }
    if (result?.nextBatch !== true || Number(result?.scanned || 0) === 0) break;
  }

  const success = errors.length === 0;
  console.log(JSON.stringify({ event: "calendar-sync-background", success, configured, scanned, synced, accessDenied, failed, errorCount: errors.length }));
  return Response.json({ success, configured, scanned, synced, accessDenied, failed, errors }, { status: success ? 200 : 500 });
};

export default handler;

export const config: Config = {
  path: "/api/background/calendar-sync",
  method: "POST",
};

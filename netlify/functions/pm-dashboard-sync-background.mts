import type { Config } from "@netlify/functions";

const handler = async (request: Request) => {
  const expected = (process.env.PROCORE_SYNC_SECRET || "").trim();
  const provided = request.headers.get("x-sync-secret")?.trim() || "";
  if (!expected || provided !== expected) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  const deadline = Date.now() + 12 * 60_000;
  let scanned = 0;
  let failed = 0;
  let skippedReason: string | null = null;
  let rateLimited = false;
  const errors: unknown[] = [];

  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/cron/pm-dashboard`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-secret": expected },
      body: JSON.stringify({ limit: 2 }),
      signal: AbortSignal.timeout(4 * 60_000),
    });
    const result = await response.json().catch(() => null) as Record<string, unknown> | null;
    scanned += Number(result?.scanned || 0);
    failed += Number(result?.failed || 0);
    if (!response.ok && response.status !== 207) {
      errors.push(result?.error || `PM dashboard sync returned ${response.status}`);
      break;
    }
    // Another worker holds the lease or Procore is cooling down: yield this tick.
    if (result?.skipped === true) {
      skippedReason = String(result?.reason || "skipped");
      break;
    }
    if (result?.rateLimited === true) {
      rateLimited = true;
      break;
    }
    if (result?.nextBatch !== true || Number(result?.scanned || 0) === 0) break;
  }

  const success = errors.length === 0;
  console.log(JSON.stringify({
    event: "pm-dashboard-sync-background",
    success,
    scanned,
    failed,
    rateLimited,
    skippedReason,
    errorCount: errors.length,
  }));
  return Response.json({ success, scanned, failed, rateLimited, skippedReason, errors }, { status: success ? 200 : 500 });
};

export default handler;

export const config: Config = {
  path: "/api/background/pm-dashboard-sync",
  method: "POST",
};

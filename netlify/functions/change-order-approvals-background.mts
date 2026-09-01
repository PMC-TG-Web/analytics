import type { Config } from "@netlify/functions";

const handler = async (request: Request) => {
  const expected = (process.env.PROCORE_SYNC_SECRET || "").trim();
  const provided = request.headers.get("x-sync-secret")?.trim() || "";
  if (!expected || provided !== expected) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  const deadline = Date.now() + 12 * 60_000;
  let offset = 0;
  let projectsScanned = 0;
  let potentialChangeOrdersScanned = 0;
  let packagesScanned = 0;
  const errors: unknown[] = [];

  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/cron/change-order-approvals`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-secret": expected },
      body: JSON.stringify({ offset, limit: 4 }),
      signal: AbortSignal.timeout(2 * 60_000),
    });
    const result = await response.json().catch(() => null);
    projectsScanned += Number(result?.projectsScanned || 0);
    potentialChangeOrdersScanned += Number(result?.potentialChangeOrdersScanned || 0);
    packagesScanned += Number(result?.packagesScanned || 0);
    if (!response.ok || result?.success === false) {
      errors.push(...(Array.isArray(result?.errors) ? result.errors : [`batch:${offset} status:${response.status}`]));
    }
    if (typeof result?.nextOffset !== "number") break;
    offset = result.nextOffset;
  }

  const success = errors.length === 0;
  console.log(JSON.stringify({
    event: "change-order-approvals-background",
    success,
    projectsScanned,
    potentialChangeOrdersScanned,
    packagesScanned,
    errorCount: errors.length,
  }));
  return Response.json({
    success,
    projectsScanned,
    potentialChangeOrdersScanned,
    packagesScanned,
    errors: errors.slice(0, 25),
  }, { status: success ? 200 : 500 });
};

export default handler;

export const config: Config = {
  path: "/api/background/change-order-approvals",
  method: "POST",
};
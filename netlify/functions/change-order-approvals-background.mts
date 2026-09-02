import type { Config } from "@netlify/functions";

const handler = async (request: Request) => {
  const expected = (process.env.PROCORE_SYNC_SECRET || "").trim();
  const provided = request.headers.get("x-sync-secret")?.trim() || "";
  if (!expected || provided !== expected) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  const deadline = Date.now() + 4 * 60_000;
  const maxProjects = Math.min(3, Math.max(1,
    Number.parseInt(process.env.PROCORE_CHANGE_ORDER_PROJECTS_PER_TICK || "3", 10) || 3,
  ));
  let projectsScanned = 0;
  let potentialChangeOrdersScanned = 0;
  let packagesScanned = 0;
  let apiRequests = 0;
  const errors: unknown[] = [];

  for (let index = 0; index < maxProjects && Date.now() < deadline; index += 1) {
    const response = await fetch(`${baseUrl}/api/cron/change-order-approvals`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-secret": expected },
      body: "{}",
      signal: AbortSignal.timeout(2 * 60_000),
    });
    const result = await response.json().catch(() => null);
    projectsScanned += Number(result?.projectsScanned || 0);
    potentialChangeOrdersScanned += Number(result?.potentialChangeOrdersScanned || 0);
    packagesScanned += Number(result?.packagesScanned || 0);
    apiRequests += Number(result?.apiRequests || response.headers.get("x-procore-api-request-count") || 0);
    if (!response.ok || result?.success === false) {
      errors.push(result?.error || `project:${result?.projectId || "unknown"} status:${response.status}`);
    }
    if (result?.skipped || result?.deferred || result?.reason === "rate_limit_cooldown") break;
  }

  const success = errors.length === 0;
  console.log(JSON.stringify({
    event: "change-order-approvals-background",
    success,
    projectsScanned,
    potentialChangeOrdersScanned,
    packagesScanned,
    apiRequests,
    errorCount: errors.length,
  }));
  return Response.json({
    success,
    projectsScanned,
    potentialChangeOrdersScanned,
    packagesScanned,
    apiRequests,
    errors: errors.slice(0, 25),
  }, { status: success ? 200 : 500 });
};

export default handler;

export const config: Config = {
  path: "/api/background/change-order-approvals",
  method: "POST",
};

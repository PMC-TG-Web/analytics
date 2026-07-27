import type { Config } from "@netlify/functions";

const handler = async (request: Request) => {
  const expected = (process.env.PROCORE_SYNC_SECRET || "").trim();
  const provided = request.headers.get("x-sync-secret")?.trim() || "";
  if (!expected || provided !== expected) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  const body = await request.json().catch(() => ({}));
  const deadline = Date.now() + 12 * 60_000;
  const results: unknown[] = [];
  const reconciliation = String(body?.mode || "") === "reconcile";
  const configuredCap = Math.min(
    12,
    Math.max(3, Number.parseInt(process.env.PROCORE_ACTUALS_MAX_PROJECTS_PER_TICK || "8", 10) || 8)
  );
  let maxProjects = reconciliation ? 1 : 3;
  for (let index = 0; index < maxProjects && Date.now() < deadline; index += 1) {
    const response = await fetch(`${baseUrl}/api/cron/actuals`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-secret": expected },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);
    results.push({ status: response.status, result });
    console.log(JSON.stringify({
      event: "actuals-sync-background",
      status: response.status,
      success: result?.success,
      skipped: result?.skipped,
      reason: result?.reason,
      projectId: result?.projectId,
      totalMs: result?.totalMs,
      queue: result?.queue,
    }));
    if (!reconciliation) {
      const recommended = Number(result?.queue?.recommendedBatchSize || 3);
      if (Number.isFinite(recommended)) {
        maxProjects = Math.min(configuredCap, Math.max(maxProjects, Math.ceil(recommended)));
      }
    }
    const rateLimited = Array.isArray(result?.steps)
      && result.steps.some((step: { rateLimited?: boolean }) => step?.rateLimited === true);
    // A slow or malformed project should be retried on its own schedule without
    // preventing the worker from advancing to the next due project.
    if (!response.ok || result?.skipped || rateLimited) break;
  }
  return Response.json({ success: true, results });
};

export default handler;

export const config: Config = {
  path: "/api/background/actuals-sync",
  method: "POST",
};

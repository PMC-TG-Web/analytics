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
  const maxProjects = String(body?.mode || "") === "reconcile" ? 1 : 3;
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
    }));
    if (!response.ok || result?.success === false || result?.skipped) break;
  }
  return Response.json({ success: true, results });
};

export default handler;

export const config: Config = {
  background: true,
  path: "/api/background/actuals-sync",
  method: "POST",
};

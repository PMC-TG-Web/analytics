import type { Config } from "@netlify/functions";

const handler = async (request: Request) => {
  const secret = (process.env.PROCORE_SYNC_SECRET || "").trim();
  if (!secret || request.headers.get("x-sync-secret")?.trim() !== secret) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  if (!baseUrl) return Response.json({ success: false, error: "No base URL configured" }, { status: 503 });

  const response = await fetch(`${baseUrl}/api/cron/project-reconciliation`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-secret": secret },
    body: "{}",
    signal: AbortSignal.timeout(13 * 60_000),
  });
  const result = await response.json().catch(() => null);
  const completed = response.ok && result?.success === true;
  console.log(JSON.stringify({
    event: "project-reconciliation-background",
    status: response.status,
    success: result?.success,
    completed,
    totalMs: result?.totalMs,
    summary: result?.detail?.summary,
  }));
  return Response.json({ success: completed, status: response.status, result }, {
    status: completed ? 200 : 500,
  });
};

export default handler;

export const config: Config = {
  path: "/api/background/project-reconciliation",
  method: "POST",
};

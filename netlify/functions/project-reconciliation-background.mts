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
  console.log(JSON.stringify({
    event: "project-reconciliation-background",
    status: response.status,
    success: result?.success,
    totalMs: result?.totalMs,
    summary: result?.detail?.summary,
  }));
  return Response.json({ success: response.ok && result?.success !== false, status: response.status, result }, {
    status: response.ok && result?.success !== false ? 200 : 500,
  });
};

export default handler;

export const config: Config = {
  path: "/api/background/project-reconciliation",
  method: "POST",
};

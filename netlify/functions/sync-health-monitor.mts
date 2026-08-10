import type { Config } from "@netlify/functions";

const handler = async () => {
  const secret = (process.env.PROCORE_SYNC_SECRET || "").trim();
  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  if (!secret || !baseUrl) {
    return Response.json({ success: false, error: "Missing sync configuration" }, { status: 500 });
  }

  const response = await fetch(`${baseUrl}/api/cron/sync/health`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-secret": secret },
    body: "{}",
  });
  const result = await response.json().catch(() => null);
  console.log(JSON.stringify({
    event: "sync-health-monitor",
    status: response.status,
    healthy: result?.healthy,
    alerted: result?.alerted,
    issues: result?.issues,
  }));
  return Response.json(result || { success: false }, { status: response.ok ? 200 : 500 });
};

export default handler;

export const config: Config = {
  schedule: "*/15 * * * *",
};

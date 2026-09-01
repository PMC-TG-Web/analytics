import type { Config } from "@netlify/functions";

const handler = async () => {
  const syncSecret = (process.env.PROCORE_SYNC_SECRET || "").trim();
  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  if (!syncSecret || !baseUrl) {
    console.error("[commitment-maker-tasks-scheduled] Missing sync secret or base URL.");
    return new Response("Missing required configuration", { status: 500 });
  }

  const response = await fetch(`${baseUrl}/api/cron/commitment-maker-tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-secret": syncSecret },
    body: "{}",
    signal: AbortSignal.timeout(12 * 60_000),
  });
  const result = await response.json().catch(() => null) as Record<string, unknown> | null;
  console.log(JSON.stringify({
    event: "commitment-maker-tasks-scheduled",
    status: response.status,
    success: result?.success,
    skipped: result?.skipped,
    projectId: result?.projectId,
    sourceChangeOrderId: result?.sourceChangeOrderId,
    error: result?.error,
  }));
  return Response.json(result || { success: false }, { status: response.status });
};

export default handler;

export const config: Config = {
  schedule: "*/5 * * * *",
};
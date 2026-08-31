import type { Config } from "@netlify/functions";

const handler = async (request: Request) => {
  const expected = (process.env.PROCORE_SYNC_SECRET || "").trim();
  const provided = request.headers.get("x-sync-secret")?.trim() || "";
  if (!expected || provided !== expected) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  const body = await request.text();
  const response = await fetch(`${baseUrl}/api/cron/commitment-maker-tasks`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-secret": expected },
    body: body || "{}",
    signal: AbortSignal.timeout(12 * 60_000),
  });
  const result = await response.json().catch(() => null);
  console.log(JSON.stringify({
    event: "commitment-maker-tasks-background",
    status: response.status,
    success: result?.success,
    projectId: result?.projectId,
    sourceChangeOrderId: result?.sourceChangeOrderId,
    error: result?.error,
  }));
  return Response.json({ success: response.ok && result?.success === true, result }, {
    status: response.ok && result?.success === true ? 200 : 500,
  });
};

export default handler;

export const config: Config = {
  path: "/api/background/commitment-maker-tasks",
  method: "POST",
};

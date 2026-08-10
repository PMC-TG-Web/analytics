import type { Config } from "@netlify/functions";

const handler = async () => {
  const secret = (process.env.PROCORE_SYNC_SECRET || "").trim();
  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  if (!secret || !baseUrl) {
    return Response.json({ success: false, error: "Missing sync configuration" }, { status: 500 });
  }

  const response = await fetch(`${baseUrl}/api/background/project-reconciliation`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-secret": secret },
    body: "{}",
  });
  console.log(JSON.stringify({ event: "project-reconciliation-dispatch", status: response.status }));
  return Response.json({ success: response.ok, dispatchStatus: response.status }, {
    status: response.ok ? 200 : 500,
  });
};

export default handler;

export const config: Config = {
  schedule: "17 * * * *",
};

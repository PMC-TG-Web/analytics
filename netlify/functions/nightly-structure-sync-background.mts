import type { Config } from "@netlify/functions";

const handler = async (request: Request) => {
  const secret = (process.env.PROCORE_SYNC_SECRET || "").trim();
  if (!secret || request.headers.get("x-sync-secret")?.trim() !== secret) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  const deadline = Date.now() + 12 * 60_000;
  const results: unknown[] = [];
  let estimateResult: unknown = null;
  for (let index = 0; index < 2 && Date.now() < deadline; index += 1) {
    const response = await fetch(`${baseUrl}/api/cron/nightly-structure`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-secret": secret },
      body: "{}",
    });
    const result = await response.json().catch(() => null);
    results.push({ status: response.status, result });
    console.log(JSON.stringify({
      event: "nightly-structure-sync-background",
      status: response.status,
      success: result?.success,
      skipped: result?.skipped,
      reason: result?.reason,
      projectId: result?.projectId,
      totalMs: result?.totalMs,
    }));
    const rateLimited = Array.isArray(result?.steps)
      && result.steps.some((step: { rateLimited?: boolean }) => step?.rateLimited === true);
    if (result?.skipped || rateLimited) break;
    if (!response.ok || result?.success === false) continue;
  }

  if (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/cron/nightly-structure`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-secret": secret },
      body: JSON.stringify({ mode: "estimates" }),
    });
    const result = await response.json().catch(() => null);
    estimateResult = { status: response.status, result };
    console.log(JSON.stringify({
      event: "nightly-estimate-sync-background",
      status: response.status,
      success: result?.success,
      skipped: result?.skipped,
      reason: result?.reason,
      projectIds: result?.projectIds,
    }));
  }

  return Response.json({ success: true, results, estimateResult });
};

export default handler;

export const config: Config = {
  path: "/api/background/nightly-structure-sync",
  method: "POST",
};

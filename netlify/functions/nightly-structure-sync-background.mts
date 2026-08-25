import type { Config } from "@netlify/functions";

const handler = async (request: Request) => {
  const secret = (process.env.PROCORE_SYNC_SECRET || "").trim();
  if (!secret || request.headers.get("x-sync-secret")?.trim() !== secret) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  const deadline = Date.now() + 12 * 60_000;
  const results: unknown[] = [];
  const estimateResults: unknown[] = [];
  const estimateCap = Math.min(
    12,
    Math.max(3, Number.parseInt(process.env.PROCORE_ESTIMATE_MAX_PROJECTS_PER_TICK || "6", 10) || 6),
  );

  // Refresh Bid Board headers first so changed estimates enter the queue, then
  // drain estimate details before slower nightly structure work.
  const headerResponse = await fetch(`${baseUrl}/api/cron/nightly-structure`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-secret": secret },
    body: JSON.stringify({ mode: "bid-board-headers" }),
  });
  const headerResult = await headerResponse.json().catch(() => null);
  const bidBoardHeaders = { status: headerResponse.status, result: headerResult };
  console.log(JSON.stringify({
    event: "nightly-bid-board-header-sync-background",
    status: headerResponse.status,
    success: headerResult?.success,
    skipped: headerResult?.skipped,
    reason: headerResult?.reason,
  }));

  for (let index = 0; index < estimateCap && Date.now() < deadline; index += 1) {
    const response = await fetch(`${baseUrl}/api/cron/nightly-structure`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-secret": secret },
      body: JSON.stringify({ mode: "estimates" }),
    });
    const result = await response.json().catch(() => null);
    estimateResults.push({ status: response.status, result });
    console.log(JSON.stringify({
      event: "nightly-estimate-sync-background",
      batch: index + 1,
      status: response.status,
      success: result?.success,
      skipped: result?.skipped,
      reason: result?.reason,
      projectIds: result?.projectIds,
    }));
    const rateLimited = Boolean(result?.detail?.rateLimited)
      || /\b429\b|rate limit|too many requests/i.test(JSON.stringify(result));
    if (result?.skipped || rateLimited) break;
  }

  const projectLinkResponse = await fetch(`${baseUrl}/api/cron/project-link-sync`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sync-secret": secret },
    body: JSON.stringify({}),
  });
  const projectLinkResult = await projectLinkResponse.json().catch(() => null);
  const projectLinkSync = { status: projectLinkResponse.status, result: projectLinkResult };
  console.log(JSON.stringify({
    event: "nightly-project-link-sync-background",
    status: projectLinkResponse.status,
    success: projectLinkResult?.success,
    skipped: projectLinkResult?.skipped,
    reason: projectLinkResult?.reason,
    projectId: projectLinkResult?.projectId,
    result: projectLinkResult?.result,
  }));

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

  return Response.json({ success: true, projectLinkSync, bidBoardHeaders, estimateResults, results });
};

export default handler;

export const config: Config = {
  path: "/api/background/nightly-structure-sync",
  method: "POST",
};

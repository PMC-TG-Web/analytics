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
  let bidBoardHeaders: unknown = null;
  let onboarding: unknown = null;
  let projectLinkSync: unknown = null;
  const purchaseOrderDiscovery: unknown[] = [];
  const estimateDetails: unknown[] = [];
  const estimateCap = Math.min(
    12,
    Math.max(3, Number.parseInt(process.env.PROCORE_ESTIMATE_MAX_PROJECTS_PER_TICK || "6", 10) || 6),
  );
  const configuredCap = Math.min(
    12,
    Math.max(3, Number.parseInt(process.env.PROCORE_ACTUALS_MAX_PROJECTS_PER_TICK || "8", 10) || 8)
  );
  const reconciliationCap = Math.min(
    3,
    Math.max(1, Number.parseInt(process.env.PROCORE_RECONCILIATION_MAX_PROJECTS_PER_TICK || "3", 10) || 3)
  );
  let maxProjects = reconciliation ? reconciliationCap : 3;
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
    if (result?.skipped || rateLimited) break;
    if (!response.ok || result?.success === false) continue;
  }

  secondaryWork: if (!reconciliation && Date.now() < deadline) {
    const headerResponse = await fetch(`${baseUrl}/api/cron/nightly-structure`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-secret": expected },
      body: JSON.stringify({ mode: "bid-board-headers" }),
    });
    const headerResult = await headerResponse.json().catch(() => null);
    bidBoardHeaders = { status: headerResponse.status, result: headerResult };
    console.log(JSON.stringify({
      event: "bid-board-header-sync-background",
      status: headerResponse.status,
      success: headerResult?.success,
      skipped: headerResult?.skipped,
      reason: headerResult?.reason,
      totalMs: headerResult?.totalMs,
    }));
    if (headerResult?.deferred || headerResult?.reason === "rate_limit_cooldown") {
      break secondaryWork;
    }

    // Estimate details are customer-facing dashboard data. Drain them before
    // onboarding and purchase-order discovery so slower secondary work cannot
    // consume the whole background-function window first.
    for (let index = 0; index < estimateCap && Date.now() < deadline; index += 1) {
      const estimateResponse = await fetch(`${baseUrl}/api/cron/nightly-structure`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-sync-secret": expected },
        body: JSON.stringify({ mode: "estimates" }),
      });
      const estimateResult = await estimateResponse.json().catch(() => null);
      estimateDetails.push({ status: estimateResponse.status, result: estimateResult });
      console.log(JSON.stringify({
        event: "estimate-detail-sync-background",
        batch: index + 1,
        status: estimateResponse.status,
        success: estimateResult?.success,
        skipped: estimateResult?.skipped,
        reason: estimateResult?.reason,
        projectIds: estimateResult?.projectIds,
      }));
      const estimateRateLimited = Boolean(estimateResult?.detail?.rateLimited)
        || /\b429\b|rate limit|too many requests/i.test(JSON.stringify(estimateResult));
      if (estimateRateLimited || estimateResult?.deferred) {
        break secondaryWork;
      }
      if (!estimateResponse.ok || estimateResult?.success === false) continue;
      if (estimateResult?.skipped) break;
    }

    const projectLinkResponse = await fetch(`${baseUrl}/api/cron/project-link-sync`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-secret": expected },
      body: JSON.stringify({}),
    });
    const projectLinkResult = await projectLinkResponse.json().catch(() => null);
    projectLinkSync = { status: projectLinkResponse.status, result: projectLinkResult };
    console.log(JSON.stringify({
      event: "project-link-sync-background",
      status: projectLinkResponse.status,
      success: projectLinkResult?.success,
      skipped: projectLinkResult?.skipped,
      reason: projectLinkResult?.reason,
      projectId: projectLinkResult?.projectId,
      result: projectLinkResult?.result,
    }));

    const response = await fetch(`${baseUrl}/api/cron/project-onboarding`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-secret": expected },
      body: "{}",
    });
    const result = await response.json().catch(() => null);
    onboarding = { status: response.status, result };
    console.log(JSON.stringify({
      event: "project-onboarding-background",
      status: response.status,
      success: result?.success,
      skipped: result?.skipped,
      reason: result?.reason,
      projectId: result?.projectId,
      totalMs: result?.totalMs,
    }));
    const rateLimited = Array.isArray(result?.steps)
      && result.steps.some((step: { rateLimited?: boolean }) => step?.rateLimited === true);
    if (rateLimited) {
      break secondaryWork;
    }

    for (let index = 0; index < 2 && Date.now() < deadline; index += 1) {
      const poResponse = await fetch(`${baseUrl}/api/cron/nightly-structure`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-sync-secret": expected },
        body: JSON.stringify({ mode: "po-discovery" }),
      });
      const poResult = await poResponse.json().catch(() => null);
      purchaseOrderDiscovery.push({ status: poResponse.status, result: poResult });
      console.log(JSON.stringify({
        event: "purchase-order-discovery-background",
        status: poResponse.status,
        success: poResult?.success,
        skipped: poResult?.skipped,
        reason: poResult?.reason,
        projectId: poResult?.projectId,
        projectNumber: poResult?.projectNumber,
        lineCount: poResult?.lineCount,
        totalMs: poResult?.totalMs,
      }));
      const poRateLimited = Array.isArray(poResult?.steps)
        && poResult.steps.some((step: { rateLimited?: boolean }) => step?.rateLimited === true);
      if (poRateLimited) {
        break secondaryWork;
      }
      if (!poResponse.ok || poResult?.success === false) continue;
      if (poResult?.skipped) break;
    }
  }
  return Response.json({
    success: true,
    bidBoardHeaders,
    projectLinkSync,
    onboarding,
    purchaseOrderDiscovery,
    estimateDetails,
    results,
  });
};

export default handler;

export const config: Config = {
  path: "/api/background/actuals-sync",
  method: "POST",
};

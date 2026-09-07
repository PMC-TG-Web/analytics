import type { Config } from "@netlify/functions";
import { procoreWorkerRetryPlan } from "../../src/lib/procoreWorkerBackoff.js";

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_WORKER_BUSY_RETRIES = 20;
const MAX_COOLDOWN_WAITS = 6;

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
  const structureCap = Math.min(
    6,
    Math.max(1, Number.parseInt(process.env.PROCORE_STRUCTURE_MAX_PROJECTS_PER_TICK || "3", 10) || 3),
  );

  // Refresh Bid Board headers first so changed estimates enter the queue, then
  // drain estimate details before slower nightly structure work.
  let bidBoardHeaders: unknown = null;
  let headerPlan = procoreWorkerRetryPlan(null);
  for (let attempt = 0; attempt < MAX_COOLDOWN_WAITS && Date.now() < deadline; attempt += 1) {
    const headerResponse = await fetch(`${baseUrl}/api/cron/nightly-structure`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-secret": secret },
      body: JSON.stringify({ mode: "bid-board-headers" }),
    });
    const headerResult = await headerResponse.json().catch(() => null);
    bidBoardHeaders = { status: headerResponse.status, result: headerResult };
    console.log(JSON.stringify({
      event: "nightly-bid-board-header-sync-background",
      status: headerResponse.status,
      success: headerResult?.success,
      skipped: headerResult?.skipped,
      reason: headerResult?.reason,
    }));
    headerPlan = procoreWorkerRetryPlan(headerResult, { deadlineMs: deadline });
    if (headerPlan.action !== "wait") break;
    await wait(headerPlan.waitMs);
  }

  if (headerPlan.action !== "proceed" && headerPlan.reason === "rate_limit_cooldown") {
    return Response.json({ success: true, deferred: true, bidBoardHeaders, estimateResults, results });
  }

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
    const plan = procoreWorkerRetryPlan(result, { deadlineMs: deadline });
    if (plan.action === "wait") {
      await wait(plan.waitMs);
      continue;
    }
    if (plan.action === "stop") break;
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

  let structureAttempts = 0;
  let workerBusyRetries = 0;
  let cooldownWaits = 0;
  while (structureAttempts < structureCap && Date.now() < deadline) {
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
    const plan = procoreWorkerRetryPlan(result, { deadlineMs: deadline });
    if (plan.action === "wait") {
      if (plan.reason === "worker_busy") {
        workerBusyRetries += 1;
        if (workerBusyRetries >= MAX_WORKER_BUSY_RETRIES) break;
      } else {
        cooldownWaits += 1;
        if (cooldownWaits >= MAX_COOLDOWN_WAITS) break;
      }
      console.log(JSON.stringify({ event: "nightly-structure-sync-background-wait", reason: plan.reason, waitMs: plan.waitMs }));
      await wait(plan.waitMs);
      continue;
    }
    if (plan.action === "stop") break;
    workerBusyRetries = 0;
    structureAttempts += 1;
  }

  return Response.json({ success: true, projectLinkSync, bidBoardHeaders, estimateResults, results });
};

export default handler;

export const config: Config = {
  path: "/api/background/nightly-structure-sync",
  method: "POST",
};

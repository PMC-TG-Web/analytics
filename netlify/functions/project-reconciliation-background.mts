import type { Config } from "@netlify/functions";
import { procoreSyncRateLimitUntil, procoreSyncResponseIsRateLimited } from "../../src/lib/procoreSyncResponse.ts";
import { procoreWorkerRetryPlan } from "../../src/lib/procoreWorkerBackoff.js";

const handler = async (request: Request) => {
  const secret = (process.env.PROCORE_SYNC_SECRET || "").trim();
  if (!secret || request.headers.get("x-sync-secret")?.trim() !== secret) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const baseUrl = (process.env.APP_BASE_URL || process.env.URL || "").replace(/\/$/, "");
  if (!baseUrl) return Response.json({ success: false, error: "No base URL configured" }, { status: 503 });

  const deadline = Date.now() + 13 * 60_000;
  let cooldownWaits = 0;
  while (Date.now() < deadline) {
    const response = await fetch(`${baseUrl}/api/cron/project-reconciliation`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-sync-secret": secret },
      body: "{}",
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
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
    if (!completed && procoreSyncResponseIsRateLimited(response.status, result)) {
      const plan = procoreWorkerRetryPlan({
        deferred: true,
        rateLimitUntil: procoreSyncRateLimitUntil(result),
      }, { deadlineMs: deadline });
      if (plan.action === "wait" && cooldownWaits < 6) {
        cooldownWaits += 1;
        await new Promise(resolve => setTimeout(resolve, plan.waitMs));
        continue;
      }
    }
    return Response.json({ success: completed, status: response.status, result }, {
      status: completed ? 200 : 500,
    });
  }
  return Response.json({ success: false, error: "Project reconciliation deadline exceeded" }, { status: 504 });
};

export default handler;

export const config: Config = {
  path: "/api/background/project-reconciliation",
  method: "POST",
};

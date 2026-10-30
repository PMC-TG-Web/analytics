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
  const { runProjectReconciliation } = await import("../../src/lib/procoreProjectReconciliation.ts");

  const deadline = Date.now() + 13 * 60_000;
  let cooldownWaits = 0;
  let busyWaits = 0;
  while (Date.now() < deadline - 30_000) {
    const result = await runProjectReconciliation({
      origin: baseUrl, secret,
      signal: AbortSignal.timeout(Math.max(1, deadline - Date.now() - 30_000)),
    });
    const completed = result?.success === true;
    console.log(JSON.stringify({
      event: "project-reconciliation-background",
      success: result?.success,
      completed,
      totalMs: 'totalMs' in result ? result.totalMs : undefined,
    }));
    if (!completed && 'reason' in result && result.reason === 'worker_busy' && busyWaits < 120) {
      busyWaits += 1;
      await new Promise(resolve => setTimeout(resolve, 1_000));
      continue;
    }
    if (!completed && procoreSyncResponseIsRateLimited(200, result)) {
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
    return Response.json({ success: completed, result }, {
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

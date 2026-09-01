import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  procoreApiErrorIsNotFound,
  procoreSyncDetailHasErrors,
  procoreSyncResponseIsRateLimited,
} from "../src/lib/procoreSyncResponse.ts";
import {
  evaluateProcoreSyncHealth,
  procoreHealthAlertFingerprint,
} from "../src/lib/procoreSyncHealth.ts";
import { procoreRateLimitDelayMs } from "../src/lib/procoreRateLimit.ts";

function headers(values) {
  return { get: (name) => values[name.toLowerCase()] ?? null };
}

test("Procore retries wait for the server's rate-limit reset epoch", () => {
  const nowMs = Date.parse("2026-08-31T16:35:12.000Z");
  assert.equal(procoreRateLimitDelayMs(headers({
    "x-rate-limit-reset": String(Date.parse("2026-08-31T16:35:27.000Z") / 1_000),
  }), {
    fallbackMs: 1_000,
    maxDelayMs: 20_000,
    nowMs,
    resetPaddingMs: 100,
  }), 15_100);
});

test("Procore rate-limit waits remain capped for distant reset windows", () => {
  assert.equal(procoreRateLimitDelayMs(headers({ "retry-after": "60" }), {
    fallbackMs: 1_000,
    maxDelayMs: 15_000,
    nowMs: 0,
  }), 15_000);
});

test("recovered 429 diagnostics do not fail a successful sync response", () => {
  const detail = {
    success: true,
    errors: [],
    diagnostics: [{ message: "Initial request returned 429; retry saved 14 entries." }],
  };
  assert.equal(procoreSyncDetailHasErrors(detail), false);
  assert.equal(procoreSyncResponseIsRateLimited(200, detail), false);
});

test("active rate limits and endpoint errors are still failures", () => {
  assert.equal(procoreSyncResponseIsRateLimited(429, { success: false }), true);
  assert.equal(procoreSyncResponseIsRateLimited(200, { success: false, error: "rate limit exceeded" }), true);
  assert.equal(procoreSyncDetailHasErrors({ success: true, errors: ["project failed"] }), true);
});

test("health evaluation catches stale reconciliation and stuck webhook work", () => {
  const now = new Date("2026-08-10T16:00:00.000Z");
  const issues = evaluateProcoreSyncHealth({
    datasets: [{
      dataset: "actuals",
      never_succeeded: 0,
      failed_projects: 0,
      max_failure_count: 0,
      newest_success: "2026-08-10T15:30:00.000Z",
    }],
    webhookQueue: [{
      status: "pending",
      count: 2,
      oldest_available: "2026-08-10T15:00:00.000Z",
    }],
    projectReconciliation: {
      last_success_at: "2026-08-09T12:00:00.000Z",
      last_attempt_at: "2026-08-09T12:00:00.000Z",
    },
  }, now);

  assert.ok(issues.some((issue) => issue.includes("reconciliation")));
  assert.ok(issues.some((issue) => issue.includes("stuck")));
});

test("health evaluation allows a completed daily reconciliation cycle", () => {
  const issues = evaluateProcoreSyncHealth({
    datasets: [{
      dataset: "actuals",
      never_succeeded: 0,
      failed_projects: 0,
      max_failure_count: 0,
      newest_success: "2026-08-10T15:30:00.000Z",
    }],
    webhookQueue: [],
    projectReconciliation: {
      last_success_at: "2026-08-10T07:10:00.000Z",
      last_attempt_at: "2026-08-10T07:10:00.000Z",
    },
  }, new Date("2026-08-10T16:00:00.000Z"));

  assert.equal(issues.some((issue) => issue.includes("reconciliation")), false);
});

test("health evaluation reports permanently failed timecard notifications", () => {
  const issues = evaluateProcoreSyncHealth({
    datasets: [
      { dataset: "actuals", never_succeeded: 0, failed_projects: 0, max_failure_count: 0, newest_success: "2026-08-19T14:55:00.000Z" },
    ],
    webhookQueue: [],
    timecardNotifications: [
      { status: "failed", count: 2, oldest_available: "2026-08-19T14:00:00.000Z" },
    ],
    projectReconciliation: {
      last_success_at: "2026-08-19T14:30:00.000Z",
      last_attempt_at: "2026-08-19T14:30:00.000Z",
    },
  }, new Date("2026-08-19T15:00:00.000Z"));

  assert.ok(issues.includes("2 timecard notification(s) are permanently failed."));
});

test("health evaluation reports an overdue estimate detail backlog", () => {
  const issues = evaluateProcoreSyncHealth({
    datasets: [
      { dataset: "actuals", never_succeeded: 0, failed_projects: 0, max_failure_count: 0, newest_success: "2026-08-24T15:55:00.000Z" },
      {
        dataset: "nightly_estimates",
        never_succeeded: 0,
        failed_projects: 0,
        max_failure_count: 0,
        due_projects: 141,
        oldest_due: "2026-08-24T12:00:00.000Z",
        newest_success: "2026-08-24T15:00:00.000Z",
      },
    ],
    webhookQueue: [],
    projectReconciliation: {
      last_success_at: "2026-08-24T15:30:00.000Z",
      last_attempt_at: "2026-08-24T15:30:00.000Z",
    },
  }, new Date("2026-08-24T16:00:00.000Z"));

  assert.ok(issues.includes("141 estimate detail project(s) have been overdue for more than 2 hours."));
});

test("Procore not-found detection handles structured and wrapped API errors", () => {
  const structured = Object.assign(new Error("missing child resource"), { status: 404 });
  assert.equal(procoreApiErrorIsNotFound(structured), true);
  assert.equal(procoreApiErrorIsNotFound(new Error("API Request Failed: Procore API error 404:")), true);
  assert.equal(procoreApiErrorIsNotFound(new Error("Procore API error 403: Forbidden")), false);
});

test("nightly structure supports targeted reruns and a scheduler-tick requeue margin", async () => {
  const route = await readFile(
    new URL("../src/app/api/cron/nightly-structure/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /const requestedProjectId = String\(body\.projectId \|\| ""\)\.trim\(\)/);
  assert.match(route, /projectId: requestedProjectId \|\| undefined/);
  assert.match(route, /const DAILY_REQUEUE_MINUTES = 24 \* 60 - 5/);
  assert.match(route, /success \? DAILY_REQUEUE_MINUTES : 30/);
});

test("missing potential-change-order child lines are warnings, not project errors", async () => {
  const route = await readFile(
    new URL("../src/app/api/procore/sync/change-order-packages/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /if \(!procoreApiErrorIsNotFound\(err\)\) throw err/);
  assert.match(route, /potential:\$\{changeOrderId\} lines skipped/);
});

test("change-order sync queues verification before persisting an approval transition", async () => {
  const route = await readFile(
    new URL("../src/app/api/procore/sync/change-order-packages/route.ts", import.meta.url),
    "utf8",
  );
  const transitionCheck = route.indexOf("await enqueueVerificationOnApprovalTransition");
  const potentialUpsert = route.indexOf("const persistedId = await upsertPotentialChangeOrder", transitionCheck);
  const packageTransitionCheck = route.indexOf("await enqueueVerificationOnApprovalTransition", transitionCheck + 1);
  const packageUpsert = route.indexOf("await upsertChangeOrderPackage", packageTransitionCheck);

  assert.ok(transitionCheck > 0 && potentialUpsert > transitionCheck);
  assert.ok(packageTransitionCheck > potentialUpsert && packageUpsert > packageTransitionCheck);
  assert.match(route, /taskKinds: \['commitment_verification'\]/);
});

test("webhook processing handles approved PCO and prime change-order resources", async () => {
  const route = await readFile(
    new URL("../src/app/api/webhooks/procore/process/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /resource\.includes\('potential change order'\)/);
  assert.match(route, /resource\.includes\('prime contract change order'\)/);
  assert.match(route, /return handleChangeOrderEvent\(event\)/);
  assert.match(route, /taskKinds: \['commitment_verification'\]/);
  assert.match(route, /isApprovedChangeOrderStatus\(params\.record\.status\)/);
});

test("webhook registration requests PCO and prime change-order events", async () => {
  const script = await readFile(
    new URL("../scripts/registerProcoreWebhook.mjs", import.meta.url),
    "utf8",
  );
  assert.match(script, /resourceName: 'Potential Change Orders'/);
  assert.match(script, /resourceName: 'Prime Contract Change Orders'/);
  assert.match(script, /'Change Order Packages'/);
});

test("approval polling queues verification before persisting newly approved headers", async () => {
  const route = await readFile(
    new URL("../src/app/api/cron/change-order-approvals/route.ts", import.meta.url),
    "utf8",
  );
  const potentialQueue = route.indexOf("await enqueueCommitmentMakerTasks", route.indexOf("persistPotentialChangeOrder"));
  const potentialPersist = route.indexOf("await upsertPotentialChangeOrder", potentialQueue);
  const packageQueue = route.indexOf("await enqueueCommitmentMakerTasks", route.indexOf("persistChangeOrderPackage"));
  const packagePersist = route.indexOf("await upsertChangeOrderPackage", packageQueue);

  assert.ok(potentialQueue > 0 && potentialPersist > potentialQueue);
  assert.ok(packageQueue > potentialPersist && packagePersist > packageQueue);
  assert.match(route, /taskKinds: \["commitment_verification"\]/);
  assert.doesNotMatch(route, /line_items/);
  assert.match(route, /const limit = Math\.min\(6/);
  assert.match(route, /nextOffset:/);
});

test("background approval worker drains bounded polling batches", async () => {
  const worker = await readFile(
    new URL("../netlify/functions/change-order-approvals-background.mts", import.meta.url),
    "utf8",
  );
  assert.match(worker, /\/api\/cron\/change-order-approvals/);
  assert.match(worker, /nextOffset/);
  assert.match(worker, /12 \* 60_000/);
});

test("middleware allows secret-authenticated change-order background work", async () => {
  const middleware = await readFile(new URL("../middleware.ts", import.meta.url), "utf8");
  assert.match(middleware, /pathname === '\/api\/background\/change-order-approvals'/);
  assert.match(middleware, /pathname === '\/api\/background\/commitment-maker-tasks'/);
});

test("health evaluation reports repeatedly failing Project Link Sync jobs", () => {
  const issues = evaluateProcoreSyncHealth({
    datasets: [
      { dataset: "actuals", never_succeeded: 0, failed_projects: 0, max_failure_count: 0, newest_success: "2026-08-24T15:55:00.000Z" },
      { dataset: "project_home_links", never_succeeded: 0, failed_projects: 2, max_failure_count: 3, newest_success: "2026-08-24T15:00:00.000Z" },
    ],
    webhookQueue: [],
    projectReconciliation: {
      last_success_at: "2026-08-24T15:30:00.000Z",
      last_attempt_at: "2026-08-24T15:30:00.000Z",
    },
  }, new Date("2026-08-24T16:00:00.000Z"));

  assert.ok(issues.includes("2 Project Link Sync job(s) are repeatedly failing."));
});

test("health evaluation reports repeated Bid Board header sync failures directly", () => {
  const issues = evaluateProcoreSyncHealth({
    datasets: [
      { dataset: "actuals", never_succeeded: 0, failed_projects: 0, max_failure_count: 0, newest_success: "2026-08-31T13:45:00.000Z" },
      { dataset: "nightly_bid_board_headers", never_succeeded: 0, failed_projects: 1, max_failure_count: 102, newest_success: "2026-08-30T04:15:00.000Z" },
    ],
    webhookQueue: [],
    projectReconciliation: {
      last_success_at: "2026-08-31T13:10:00.000Z",
      last_attempt_at: "2026-08-31T13:10:00.000Z",
    },
  }, new Date("2026-08-31T13:50:00.000Z"));

  assert.ok(issues.includes("1 Bid Board header sync job(s) are repeatedly failing."));
});

test("health evaluation allows a fresh estimate detail queue", () => {
  const issues = evaluateProcoreSyncHealth({
    datasets: [
      { dataset: "actuals", never_succeeded: 0, failed_projects: 0, max_failure_count: 0, newest_success: "2026-08-24T15:55:00.000Z" },
      {
        dataset: "nightly_estimates",
        never_succeeded: 0,
        failed_projects: 0,
        max_failure_count: 0,
        due_projects: 3,
        oldest_due: "2026-08-24T15:30:00.000Z",
        newest_success: "2026-08-24T15:00:00.000Z",
      },
    ],
    webhookQueue: [],
    projectReconciliation: {
      last_success_at: "2026-08-24T15:30:00.000Z",
      last_attempt_at: "2026-08-24T15:30:00.000Z",
    },
  }, new Date("2026-08-24T16:00:00.000Z"));

  assert.ok(!issues.some((issue) => issue.includes("estimate detail")));
});

test("health evaluation stays quiet when core automation is current", () => {
  const now = new Date("2026-08-10T16:00:00.000Z");
  assert.deepEqual(evaluateProcoreSyncHealth({
    datasets: [
      { dataset: "actuals", never_succeeded: 0, failed_projects: 0, max_failure_count: 0, newest_success: "2026-08-10T15:30:00.000Z" },
      { dataset: "nightly_structure", never_succeeded: 0, failed_projects: 0, max_failure_count: 0, newest_success: "2026-08-10T10:00:00.000Z" },
      { dataset: "project_onboarding", never_succeeded: 0, failed_projects: 0, max_failure_count: 0, newest_success: "2026-08-10T15:00:00.000Z" },
    ],
    webhookQueue: [{ status: "completed", count: 10, oldest_available: "2026-08-01T00:00:00.000Z" }],
    projectReconciliation: {
      last_success_at: "2026-08-10T15:17:00.000Z",
      last_attempt_at: "2026-08-10T15:17:00.000Z",
    },
  }, now), []);
});

test("health evaluation allows the planned nightly Actuals pause and restart grace period", () => {
  const snapshot = {
    datasets: [{
      dataset: "actuals",
      never_succeeded: 0,
      failed_projects: 0,
      max_failure_count: 0,
      newest_success: "2026-08-17T05:55:41.690Z",
    }],
    webhookQueue: [],
    projectReconciliation: {
      last_success_at: "2026-08-17T09:00:00.000Z",
      last_attempt_at: "2026-08-17T09:00:00.000Z",
    },
  };

  assert.deepEqual(
    evaluateProcoreSyncHealth(snapshot, new Date("2026-08-17T09:00:38.390Z")),
    [],
  );
  assert.deepEqual(
    evaluateProcoreSyncHealth(snapshot, new Date("2026-08-17T10:29:59.000Z")),
    [],
  );
});

test("health evaluation alerts when Actuals has not resumed after the nightly grace period", () => {
  const issues = evaluateProcoreSyncHealth({
    datasets: [{
      dataset: "actuals",
      never_succeeded: 0,
      failed_projects: 0,
      max_failure_count: 0,
      newest_success: "2026-08-17T05:55:41.690Z",
    }],
    webhookQueue: [],
    projectReconciliation: {
      last_success_at: "2026-08-17T10:00:00.000Z",
      last_attempt_at: "2026-08-17T10:00:00.000Z",
    },
  }, new Date("2026-08-17T10:30:00.000Z"));

  assert.ok(issues.includes("Actuals have not completed successfully within 3 hours."));
});

test("middleware allows secret-authenticated reconciliation routes", async () => {
  const middleware = await readFile(new URL("../middleware.ts", import.meta.url), "utf8");
  assert.match(middleware, /pathname === '\/api\/background\/project-reconciliation'/);
  assert.match(middleware, /pathname === '\/api\/cron\/project-reconciliation'/);
  assert.match(middleware, /pathname === '\/api\/cron\/project-link-sync'/);
  assert.match(middleware, /pathname === '\/api\/cron\/commitment-maker-tasks'/);
});

test("full project reconciliation has timeout headroom and rejects truncated responses", async () => {
  const allProjectsRoute = await readFile(
    new URL("../src/app/api/procore/sync/all-projects/route.ts", import.meta.url),
    "utf8",
  );
  const backgroundWorker = await readFile(
    new URL("../netlify/functions/project-reconciliation-background.mts", import.meta.url),
    "utf8",
  );

  assert.match(allProjectsRoute, /mapWithConcurrency\(allProjectStages, writeConcurrency/);
  assert.match(allProjectsRoute, /mapWithConcurrency\(allV1Projects, writeConcurrency/);
  assert.match(allProjectsRoute, /mapWithConcurrency\(allBidBoardProjects, writeConcurrency/);
  assert.match(backgroundWorker, /result\?\.success === true/);
  assert.doesNotMatch(backgroundWorker, /result\?\.success !== false/);
});

test("health alert deduplication ignores changing backlog counts", () => {
  assert.equal(
    procoreHealthAlertFingerprint(["57 nightly structure projects are failing."]),
    procoreHealthAlertFingerprint(["41 nightly structure projects are failing."]),
  );
});

test("background workers prioritize and drain multiple estimate projects per tick", async () => {
  const actualsWorker = await readFile(
    new URL("../netlify/functions/actuals-sync-background.mts", import.meta.url),
    "utf8",
  );
  const nightlyWorker = await readFile(
    new URL("../netlify/functions/nightly-structure-sync-background.mts", import.meta.url),
    "utf8",
  );

  for (const worker of [actualsWorker, nightlyWorker]) {
    assert.match(worker, /PROCORE_ESTIMATE_MAX_PROJECTS_PER_TICK \|\| "6"/);
    assert.ok(
      worker.indexOf('mode: "estimates"') < worker.indexOf('body: "{}"'),
      "estimate draining should run before generic structure/onboarding work",
    );
  }

  assert.match(actualsWorker, /secondaryWork: if \(!reconciliation/);
  assert.match(actualsWorker, /if \(estimateRateLimited\) \{\s+break secondaryWork;/);
  assert.ok(
    actualsWorker.indexOf("/api/cron/actuals") < actualsWorker.indexOf('mode: "estimates"'),
    "Actuals should run before secondary estimate work can start a shared rate-limit cooldown",
  );
});

test("estimate requeues preserve fair ordering instead of resetting to the epoch", async () => {
  const queue = await readFile(
    new URL("../src/lib/procoreSyncQueue.ts", import.meta.url),
    "utf8",
  );
  const estimatingQueue = queue.slice(
    queue.indexOf("export async function queueEstimatingSyncProjects"),
    queue.indexOf("export async function seedSingletonSyncQueue"),
  );

  assert.match(
    estimatingQueue,
    /next_run_at = LEAST\(procore_sync_project_states\.next_run_at, NOW\(\)\)/,
  );
  assert.doesNotMatch(estimatingQueue, /1970-01-01/);
});

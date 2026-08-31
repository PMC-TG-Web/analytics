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
      last_success_at: "2026-08-10T12:00:00.000Z",
      last_attempt_at: "2026-08-10T12:00:00.000Z",
    },
  }, now);

  assert.ok(issues.some((issue) => issue.includes("reconciliation")));
  assert.ok(issues.some((issue) => issue.includes("stuck")));
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

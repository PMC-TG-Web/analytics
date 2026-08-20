import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
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

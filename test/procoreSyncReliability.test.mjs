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

test("middleware allows secret-authenticated reconciliation routes", async () => {
  const middleware = await readFile(new URL("../middleware.ts", import.meta.url), "utf8");
  assert.match(middleware, /pathname === '\/api\/background\/project-reconciliation'/);
  assert.match(middleware, /pathname === '\/api\/cron\/project-reconciliation'/);
});

test("health alert deduplication ignores changing backlog counts", () => {
  assert.equal(
    procoreHealthAlertFingerprint(["57 nightly structure projects are failing."]),
    procoreHealthAlertFingerprint(["41 nightly structure projects are failing."]),
  );
});

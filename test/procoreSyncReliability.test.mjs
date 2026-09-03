import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  procoreApiErrorIsNotFound,
  procoreSyncDetailHasErrors,
  procoreSyncRateLimitUntil,
  procoreSyncResponseIsRateLimited,
} from "../src/lib/procoreSyncResponse.ts";
import {
  evaluateProcoreSyncHealth,
  procoreHealthAlertFingerprint,
} from "../src/lib/procoreSyncHealth.ts";
import {
  procoreBackgroundReserve,
  procoreQuotaObservation,
  procoreRateLimitDelayMs,
  procoreRateLimitRetryable,
} from "../src/lib/procoreRateLimit.ts";

function headers(values) {
  return { get: (name) => values[name.toLowerCase()] ?? null };
}

test("Procore 429s are only retried in-process when the window reopens within the retry budget", () => {
  const nowMs = Date.parse("2026-09-03T12:00:00.000Z");
  assert.equal(procoreRateLimitRetryable(headers({
    "x-rate-limit-reset": String(Date.parse("2026-09-03T12:00:08.000Z") / 1_000),
  }), { maxDelayMs: 15_000, nowMs }), true);
  assert.equal(procoreRateLimitRetryable(headers({
    "x-rate-limit-reset": String(Date.parse("2026-09-03T12:11:00.000Z") / 1_000),
  }), { maxDelayMs: 15_000, nowMs }), false);
  assert.equal(procoreRateLimitRetryable(headers({ "retry-after": "600" }), { maxDelayMs: 15_000, nowMs }), false);
  assert.equal(procoreRateLimitRetryable(headers({}), { maxDelayMs: 15_000, nowMs }), true);
});

test("the shared Procore client skips doomed retries once the window is exhausted", async () => {
  const client = await readFile(new URL("../src/lib/procore.ts", import.meta.url), "utf8");
  assert.match(client, /if \(!procoreRateLimitRetryable\(response\.headers, \{ maxDelayMs \}\)\)/);
  assert.match(client, /beyond retry budget\. Not retrying\./);
});

test("webhook processing treats provider throttling as a deferral, not an event failure", async () => {
  const route = await readFile(
    new URL("../src/app/api/webhooks/procore/process/route.ts", import.meta.url),
    "utf8",
  );
  // Batch-level: defer before claiming anything during an active cooldown.
  assert.match(route, /getProcoreBackgroundCooldown\(cooldownCompanyId, now\)/);
  assert.match(route, /reason: 'rate_limit_cooldown'/);
  // Item-level: give the attempt back and make it due at the cooldown end.
  assert.match(route, /attempts: \{ decrement: 1 \}/);
  assert.match(route, /availableAt: rateLimitUntil,/);
  assert.match(route, /batchRateLimitUntil = rateLimitUntil;/);
  // Handlers only soft-delete on a real 404.
  const softDeleteGuards = route.match(/if \(!isNotFoundError\(error\)\) throw error;/g) || [];
  assert.ok(softDeleteGuards.length >= 4, `expected 404 guards on every soft-delete path, found ${softDeleteGuards.length}`);
  assert.doesNotMatch(route, /\} catch \{\n\s+\/\/ 404 — entry deleted/);
});

test("PM dashboard sweep shares the worker lease and yields on rate limits", async () => {
  const route = await readFile(new URL("../src/app/api/cron/pm-dashboard/route.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../netlify/functions/pm-dashboard-sync-background.mts", import.meta.url), "utf8");
  assert.match(route, /acquireProcoreWorker\(companyId, 4\)/);
  assert.match(route, /releaseProcoreWorker\(companyId, worker\.leaseId\)/);
  assert.match(route, /const DEFAULT_REPOLL_MINUTES = 90;/);
  assert.match(route, /nextBatch: !rateLimited && !requestedProjectId/);
  assert.match(worker, /result\?\.skipped === true/);
  assert.match(worker, /result\?\.rateLimited === true/);
});

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

test("Procore background reserve accepts an explicit zero", () => {
  assert.equal(procoreBackgroundReserve(undefined), 100);
  assert.equal(procoreBackgroundReserve("invalid"), 100);
  assert.equal(procoreBackgroundReserve("0"), 0);
  assert.equal(procoreBackgroundReserve("25"), 25);
});

test("Procore quota observations reserve background capacity until the provider reset", () => {
  const nowMs = Date.parse("2026-09-01T18:30:00.000Z");
  const resetSeconds = Date.parse("2026-09-01T19:00:00.000Z") / 1_000;
  const observation = procoreQuotaObservation(headers({
    "x-rate-limit-limit": "3600",
    "x-rate-limit-remaining": "75",
    "x-rate-limit-reset": String(resetSeconds),
  }), 200, {
    reserve: 100,
    fallbackCooldownMs: 15 * 60_000,
    nowMs,
    resetPaddingMs: 1_500,
  });

  assert.equal(observation.limit, 3600);
  assert.equal(observation.remaining, 75);
  assert.equal(observation.rateLimited, false);
  assert.equal(observation.resetAt?.toISOString(), "2026-09-01T19:00:01.500Z");
  assert.equal(observation.cooldownUntil?.toISOString(), "2026-09-01T19:00:01.500Z");
});

test("Procore quota reserve scales down for small provider windows", () => {
  const nowMs = Date.parse("2026-09-01T18:30:00.000Z");
  const resetSeconds = Date.parse("2026-09-01T18:30:10.000Z") / 1_000;
  const options = {
    reserve: 100,
    fallbackCooldownMs: 15 * 60_000,
    nowMs,
    resetPaddingMs: 1_500,
  };

  const available = procoreQuotaObservation(headers({
    "x-rate-limit-limit": "25",
    "x-rate-limit-remaining": "24",
    "x-rate-limit-reset": String(resetSeconds),
  }), 200, options);
  const reserved = procoreQuotaObservation(headers({
    "x-rate-limit-limit": "25",
    "x-rate-limit-remaining": "5",
    "x-rate-limit-reset": String(resetSeconds),
  }), 200, options);

  assert.equal(available.cooldownUntil, null);
  assert.equal(reserved.cooldownUntil?.toISOString(), "2026-09-01T18:30:11.500Z");
});

test("Procore 429 observations use a bounded fallback when reset headers are absent", () => {
  const observation = procoreQuotaObservation(headers({}), 429, {
    reserve: 100,
    fallbackCooldownMs: 15 * 60_000,
    nowMs: Date.parse("2026-09-01T18:30:00.000Z"),
  });

  assert.equal(observation.rateLimited, true);
  assert.equal(observation.cooldownUntil?.toISOString(), "2026-09-01T18:45:00.000Z");
});

test("successful responses without quota headers do not create a false cooldown", () => {
  const observation = procoreQuotaObservation(headers({}), 200, {
    reserve: 100,
    fallbackCooldownMs: 15 * 60_000,
    nowMs: Date.parse("2026-09-01T18:30:00.000Z"),
  });

  assert.equal(observation.limit, null);
  assert.equal(observation.remaining, null);
  assert.equal(observation.resetAt, null);
  assert.equal(observation.cooldownUntil, null);
  assert.equal(observation.rateLimited, false);
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

test("nested cooldown details preserve the provider reset instead of inventing 15 minutes", () => {
  assert.equal(
    procoreSyncRateLimitUntil({
      success: false,
      errors: ["Procore background rate limit cooldown is active until 2026-09-02T11:35:22.500Z."],
    })?.toISOString(),
    "2026-09-02T11:35:22.500Z",
  );
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

test("health evaluation catches an old Actuals queue even while one project is succeeding", () => {
  const issues = evaluateProcoreSyncHealth({
    datasets: [{
      dataset: "actuals",
      never_succeeded: 0,
      failed_projects: 0,
      max_failure_count: 0,
      due_projects: 14,
      oldest_due: "2026-09-02T10:00:00.000Z",
      newest_success: "2026-09-02T12:55:00.000Z",
    }],
    webhookQueue: [],
    projectReconciliation: {
      last_success_at: "2026-09-02T07:10:00.000Z",
      last_attempt_at: "2026-09-02T07:10:00.000Z",
    },
  }, new Date("2026-09-02T13:00:00.000Z"));

  assert.ok(issues.includes("14 Actuals project(s) have been waiting for more than 2 hours."));
});

test("health evaluation catches an overdue change-order approval queue", () => {
  const issues = evaluateProcoreSyncHealth({
    datasets: [
      { dataset: "actuals", never_succeeded: 0, failed_projects: 0, max_failure_count: 0, newest_success: "2026-09-02T12:55:00.000Z" },
      {
        dataset: "change_order_approvals",
        never_succeeded: 0,
        failed_projects: 0,
        max_failure_count: 0,
        due_projects: 5,
        oldest_due: "2026-09-02T09:00:00.000Z",
        newest_success: "2026-09-02T12:00:00.000Z",
      },
    ],
    webhookQueue: [],
    projectReconciliation: {
      last_success_at: "2026-09-02T07:10:00.000Z",
      last_attempt_at: "2026-09-02T07:10:00.000Z",
    },
  }, new Date("2026-09-02T13:00:00.000Z"));

  assert.ok(issues.includes("5 change-order approval project(s) have been waiting for more than 3 hours."));
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
  assert.match(route, /PROCORE_BID_BOARD_SYNC_INTERVAL_MINUTES \|\| "60"/);
  assert.match(route, /x-procore-api-request-count/);
});

test("Actuals uses watermarks and rotating reconciliation cursors", async () => {
  const route = await readFile(
    new URL("../src/app/api/cron/actuals/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /buildIncrementalActualsWindow/);
  assert.match(route, /buildReconciliationActualsWindow/);
  assert.match(route, /PROCORE_ACTUALS_SYNC_OVERLAP_DAYS \|\| 3/);
  assert.match(route, /reconciliationCursor/);
  assert.match(route, /rateLimitInherited/);
  assert.match(route, /apiRequests/);
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
  const plan = await import("../src/lib/procoreWebhookPlan.js");
  const names = plan.PROJECT_WEBHOOK_TRIGGER_PLAN.map((entry) => entry.resourceName);
  assert.ok(names.includes("Potential Change Orders"));
  assert.ok(names.includes("Change Order Packages"));
  assert.ok(plan.RESOURCE_ALIASES["Change Order Packages"].includes("Prime Contract Change Orders"));
});

test("webhook plan separates company-level and project-level resources", async () => {
  const plan = await import("../src/lib/procoreWebhookPlan.js");
  const company = plan.COMPANY_WEBHOOK_TRIGGER_PLAN.map((entry) => entry.resourceName);
  const project = plan.PROJECT_WEBHOOK_TRIGGER_PLAN.map((entry) => entry.resourceName);

  assert.ok(company.includes("Projects"));
  for (const name of ["RFIs", "Task Items", "Meetings", "Potential Change Orders", "Change Order Packages"]) {
    assert.ok(project.includes(name), `${name} must be a project-level trigger`);
    assert.ok(!company.includes(name), `${name} is not exposed by the company catalog`);
  }

  const priority = plan.projectWebhookPlanForGroups(["priority"]).map((entry) => entry.resourceName);
  assert.deepEqual(priority, ["RFIs", "Task Items", "Meetings", "Potential Change Orders", "Change Order Packages"]);
  assert.deepEqual(plan.resolveProjectWebhookGroups(undefined), ["priority"]);
  assert.deepEqual(plan.resolveProjectWebhookGroups("priority, actuals"), ["priority", "actuals"]);
});

test("webhook trigger resolution honours catalog actions and skips existing triggers", async () => {
  const { resolveTriggerPlan, triggerKeySet } = await import("../src/lib/procoreWebhookPlan.js");
  const catalog = [
    { name: "RFIs", actions: ["create", "update", "delete"] },
    { name: "Task Items", actions: ["create", "update"] },
    { name: "Change Order Packages", actions: ["create", "update", "delete"] },
  ];
  const existing = triggerKeySet([{ resource_name: "RFIs", event_type: "CREATE" }]);
  const { planned, resolution } = resolveTriggerPlan(
    [
      { resourceName: "RFIs", eventTypes: ["create", "update", "delete"] },
      { resourceName: "Task Items", eventTypes: ["create", "update", "delete"] },
      { resourceName: "Prime Contract Change Orders", eventTypes: ["create", "update"] },
      { resourceName: "Meetings", eventTypes: ["create"] },
    ],
    catalog,
    existing,
  );

  assert.deepEqual(planned, [
    { resourceName: "RFIs", eventType: "update" },
    { resourceName: "RFIs", eventType: "delete" },
    { resourceName: "Task Items", eventType: "create" },
    { resourceName: "Task Items", eventType: "update" },
    { resourceName: "Change Order Packages", eventType: "create" },
    { resourceName: "Change Order Packages", eventType: "update" },
  ]);
  assert.ok(resolution.some((entry) => entry.requested === "Meetings" && entry.reason));
});

test("project-level webhook registration exists in the script, the lib, and onboarding", async () => {
  const script = await readFile(
    new URL("../scripts/registerProcoreWebhook.mjs", import.meta.url),
    "utf8",
  );
  const lib = await readFile(
    new URL("../src/lib/procoreProjectWebhooks.ts", import.meta.url),
    "utf8",
  );
  const onboarding = await readFile(
    new URL("../src/app/api/cron/project-onboarding/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(script, /--register-projects/);
  assert.match(script, /projects\/\$\{encodeURIComponent\(projectId\)\}\/webhooks/);
  assert.match(script, /if \(\/\\b429\\b\/\.test\(err\.message\)\) throw err;/);
  assert.match(lib, /export async function ensureProjectWebhookHook/);
  assert.match(lib, /await makeRequest\(/);
  assert.match(onboarding, /ensureProjectWebhookHook\(/);
  assert.match(onboarding, /step: "project-webhooks"/);
});

test("webhook processing routes RFI, Task Item, and Meeting events to single-record PM dashboard sync", async () => {
  const route = await readFile(
    new URL("../src/app/api/webhooks/procore/process/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /resource === 'rfis' \|\| resource === 'rfi'/);
  assert.match(route, /resource === 'task items'/);
  assert.match(route, /resource === 'meetings'/);
  assert.match(route, /return handlePmActionItemEvent\(event, pmSourceType\)/);
  assert.match(route, /await deletePmDashboardActionItem\(ref\)/);
  assert.match(route, /await syncPmDashboardActionItem\(ref/);

  const sync = await readFile(
    new URL("../src/lib/pmDashboardSync.ts", import.meta.url),
    "utf8",
  );
  // A 404 must remove the mirror row; every other error must propagate for queue retry.
  assert.match(sync, /if \(errorStatus\(error\) === 404\)/);
  assert.match(sync, /throw error;/);
  assert.match(sync, /await deletePmDashboardActionItem\(ref\);\s*return \{ outcome: "deleted" \};/);
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
  assert.match(route, /seedChangeOrderApprovalQueue/);
  assert.match(route, /acquireProcoreWorker/);
  assert.match(route, /claimDueProject/);
  assert.match(route, /nextRunMinutes/);
  assert.doesNotMatch(route, /projects\.slice\(offset/);
});

test("background approval worker drains bounded polling batches", async () => {
  const worker = await readFile(
    new URL("../netlify/functions/change-order-approvals-background.mts", import.meta.url),
    "utf8",
  );
  assert.match(worker, /\/api\/cron\/change-order-approvals/);
  assert.match(worker, /PROCORE_CHANGE_ORDER_PROJECTS_PER_TICK \|\| "3"/);
  assert.match(worker, /result\?\.deferred/);
  assert.match(worker, /result\?\.reason === "worker_busy"/);
  assert.match(worker, /await wait\(1_000\)/);
  assert.doesNotMatch(worker, /nextOffset/);
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

test("health evaluation identifies provider quota recovery when data is stale", () => {
  const issues = evaluateProcoreSyncHealth({
    datasets: [{
      dataset: "actuals",
      never_succeeded: 0,
      failed_projects: 0,
      max_failure_count: 0,
      newest_success: "2026-09-01T15:05:00.000Z",
    }],
    webhookQueue: [],
    projectReconciliation: {
      last_success_at: "2026-09-01T11:10:00.000Z",
      last_attempt_at: "2026-09-01T11:10:00.000Z",
    },
    control: {
      rate_limit_until: "2026-09-01T19:00:01.500Z",
      last_429_at: "2026-09-01T18:39:33.000Z",
      rate_limit_limit: 3600,
      rate_limit_remaining: 0,
      rate_limit_reset_at: "2026-09-01T19:00:00.000Z",
      rate_limit_observed_at: "2026-09-01T18:39:33.000Z",
    },
  }, new Date("2026-09-01T18:45:00.000Z"));

  assert.ok(issues.includes(
    "Actuals have not completed successfully within 3 hours. Procore background quota recovery is active until 2026-09-01T19:00:01.500Z.",
  ));
  assert.equal(issues.some((issue) => issue.includes("project(s) are repeatedly failing")), false);
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
  assert.match(actualsWorker, /result\?\.reason === "worker_busy"/);
  assert.match(actualsWorker, /await wait\(1_000\)/);
  assert.match(actualsWorker, /if \(estimateRateLimited \|\| estimateResult\?\.deferred\) \{\s+break secondaryWork;/);
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

test("provider rate limits defer queue work without creating project failures", async () => {
  const queue = await readFile(
    new URL("../src/lib/procoreSyncQueue.ts", import.meta.url),
    "utf8",
  );
  const deferred = queue.slice(
    queue.indexOf("export async function deferProjectSync"),
    queue.indexOf("export async function parkProjectSync"),
  );
  assert.match(deferred, /next_run_at = GREATEST/);
  assert.match(deferred, /HASHTEXT\(project_id \|\| ':' \|\| dataset\)/);
  assert.doesNotMatch(deferred, /failure_count/);
  assert.doesNotMatch(deferred, /last_error/);

  for (const routePath of [
    "../src/app/api/cron/actuals/route.ts",
    "../src/app/api/cron/nightly-structure/route.ts",
    "../src/app/api/cron/project-onboarding/route.ts",
    "../src/app/api/cron/project-link-sync/route.ts",
  ]) {
    const route = await readFile(new URL(routePath, import.meta.url), "utf8");
    assert.match(route, /deferProjectSync\(\{/);
  }

  const projectLinkRoute = await readFile(
    new URL("../src/app/api/cron/project-link-sync/route.ts", import.meta.url),
    "utf8",
  );
  assert.equal(
    projectLinkRoute.match(/if \(errorStatus\(error\) === 429\) throw error;/g)?.length,
    2,
  );
  assert.match(projectLinkRoute, /const provided = \(error as \{ rateLimitUntil\?: unknown \}\)\?\.rateLimitUntil/);
});

test("the shared Procore client gates background traffic but preserves interactive access", async () => {
  const procore = await readFile(
    new URL("../src/lib/procore.ts", import.meta.url),
    "utf8",
  );
  assert.match(procore, /runWithProcoreRequestContext\('background', operation\)/);
  assert.match(procore, /runWithProcoreRequestContext\('interactive', operation\)/);
  assert.match(procore, /request\.headers\.get\('x-cron-secret'\)/);
  assert.match(procore, /process\.env\.PROCORE_SYNC_SECRET, process\.env\.CRON_SECRET/);
  assert.match(
    procore,
    /if \(hasValidProcoreSyncSecret\(request\)\) \{\s+return runWithProcoreRequestContext\('background', operation\)/,
  );
  assert.match(procore, /requestContext\?\.lane === 'background'/);
  assert.match(procore, /x-procore-api-request-count/);
  assert.match(procore, /x-procore-rate-limit-until/);
  assert.match(procore, /await getProcoreBackgroundCooldown\(companyId\)/);
  assert.match(procore, /deferred\.status = 429/);
  assert.match(procore, /tokenError\.status = response\.status/);
  assert.match(procore, /wrapped\.rateLimitUntil = \(error as ErrorWithStatusAndCause\)\.rateLimitUntil/);
});

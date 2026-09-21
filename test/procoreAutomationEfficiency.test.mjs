import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { actualsPollingMinutes, pmDashboardPollingMinutes, purchaseOrderDiscoveryPolling } from "../src/lib/procorePollingPolicy.ts";
import { recoverStaleWebhookClaims } from "../src/lib/procoreWebhookRecovery.ts";
import { ensureProjectWebhookHook, projectWebhookDestinationUrl } from "../src/lib/procoreProjectWebhooks.ts";
import { hasActualsWebhookCoverage } from "../src/lib/procoreWebhookPlan.js";
import { evaluateProcoreSyncHealth } from "../src/lib/procoreSyncHealth.ts";

test("PM polling recognizes canonical closeout, excludes templates, and preserves active overrides", () => {
  assert.equal(pmDashboardPollingMinutes({ status: "Post-Construction", bidBoardStatus: "Complete" }), 1440);
  assert.equal(pmDashboardPollingMinutes({ status: "Post-Construction" }), 1440);
  assert.equal(pmDashboardPollingMinutes({ status: "Post-Construction", bidBoardStatus: "In Progress" }), 90);
  assert.equal(pmDashboardPollingMinutes({ projectName: "New Job Template", status: "Active" }), null);
  assert.equal(pmDashboardPollingMinutes({ bidBoardStatus: "Cancelled" }), null);
  assert.equal(pmDashboardPollingMinutes({ bidBoardStatus: "Bid Submitted" }), 360);
  assert.equal(pmDashboardPollingMinutes({ status: null }), 90);
  assert.equal(pmDashboardPollingMinutes({ status: "Active" }, 120), 120);
});

test("empty PO discovery backs off to one day, failures do not advance it, and finding lines resets it", () => {
  let emptyChecks;
  const intervals = [];
  for (let i = 0; i < 9; i++) {
    const result = purchaseOrderDiscoveryPolling({ previousEmptyChecks: emptyChecks, success: true, lineCount: 0 });
    emptyChecks = result.emptyChecks;
    intervals.push(result.nextRunMinutes);
  }
  assert.deepEqual(intervals, [30, 60, 120, 240, 480, 960, 1440, 1440, 1440]);
  assert.deepEqual(purchaseOrderDiscoveryPolling({ previousEmptyChecks: 4, success: false, lineCount: 0 }), { emptyChecks: 4, nextRunMinutes: 30 });
  assert.equal(purchaseOrderDiscoveryPolling({ previousEmptyChecks: 4, success: true, lineCount: 3 }).emptyChecks, 0);
  for (const invalid of [undefined, "invalid", -5, Infinity]) {
    assert.equal(purchaseOrderDiscoveryPolling({ previousEmptyChecks: invalid, success: true, lineCount: 0 }).nextRunMinutes, 30);
  }
});

const now = new Date("2026-09-09T16:00:00Z");
const workingCoverage = {
  active: true, recentlyActive: true, activeMinutes: 90, idleMinutes: 1440,
  webhookCoverage: true, webhookVerifiedAt: new Date("2026-09-08T16:00:00Z"),
  webhookFailureCount: 0, lastActualsEventAt: new Date("2026-09-09T15:00:00Z"), now,
};

test("Actuals only slows after verified coverage and recent successful event delivery", () => {
  assert.equal(actualsPollingMinutes(workingCoverage), 180);
  assert.equal(actualsPollingMinutes({ ...workingCoverage, recentlyActive: false }), 360);
  assert.equal(actualsPollingMinutes({ ...workingCoverage, active: false }), 1440);
  assert.equal(actualsPollingMinutes({ ...workingCoverage, activeMinutes: 240 }), 240);
  for (const patch of [
    { webhookCoverage: false }, { webhookCoverage: "true" }, { webhookFailureCount: 1 },
    { webhookVerifiedAt: null }, { webhookVerifiedAt: new Date("2026-08-01") },
    { lastActualsEventAt: null }, { lastActualsEventAt: new Date("2026-08-01") },
    { webhookVerifiedAt: new Date("2027-01-01") },
  ]) assert.equal(actualsPollingMinutes({ ...workingCoverage, ...patch }), 90);
});

function fakeWebhookApi({ status = "active", omitReadback = false, failAfter = null } = {}) {
  const triggers = [];
  let failuresLeft = failAfter === null ? 0 : 1;
  let hookReads = 0;
  let creates = 0;
  const hook = { id: "hook-1", namespace: "pmc-analytics", status,
    destination_url: projectWebhookDestinationUrl(), destination_headers: { Authorization: "*****example" } };
  const request = async (path, _token, options) => {
    if (options?.method === "POST") {
      if (failuresLeft && creates === failAfter) { failuresLeft--; throw Object.assign(new Error("Rate limited"), { status: 429 }); }
      const body = JSON.parse(options.body);
      assert.equal(triggers.some((t) => t.resource_name === body.resource_name && t.event_type === body.event_type), false);
      triggers.push(body); creates++;
      return { data: body };
    }
    if (path.includes("/resources?")) return { data: [
      { name: "Timecard Entries", actions: ["create", "update", "delete"] },
      { name: "Productivity Logs", actions: ["create", "update", "delete"] },
    ] };
    if (path.includes("/triggers?")) return { data: omitReadback && hookReads ? triggers.slice(1) : [...triggers] };
    if (path.includes("/hooks?")) return { data: [hook] };
    if (path.endsWith("/hooks/hook-1")) { hookReads++; return { data: hook }; }
    throw new Error(`Unexpected webhook request: ${path}`);
  };
  return { request, triggers, creates: () => creates };
}

const ensureOptions = { companyId: "test-company", projectId: "test-project", token: "test-token", sharedSecret: "test-example", groups: ["actuals"] };

test("registration verifies complete Actuals coverage and repeat runs do not duplicate triggers", async () => {
  const api = fakeWebhookApi();
  const first = await ensureProjectWebhookHook({ ...ensureOptions, request: api.request });
  assert.equal(first.triggersCreated, 6);
  assert.equal(first.actualsCovered, true);
  assert.equal(first.apiRequests, 11);
  const second = await ensureProjectWebhookHook({ ...ensureOptions, request: api.request });
  assert.equal(second.triggersCreated, 0);
  assert.equal(api.creates(), 6);
});

test("a quota-interrupted registration resumes without duplicating earlier triggers", async () => {
  const api = fakeWebhookApi({ failAfter: 2 });
  await assert.rejects(ensureProjectWebhookHook({ ...ensureOptions, request: api.request }), { status: 429 });
  assert.equal(api.triggers.length, 2);
  const result = await ensureProjectWebhookHook({ ...ensureOptions, request: api.request });
  assert.equal(result.triggersCreated, 4);
  assert.equal(result.actualsCovered, true);
});

test("inactive hooks and incomplete readback cannot establish working coverage", async () => {
  for (const options of [{ status: "inactive" }, { omitReadback: true }]) {
    const api = fakeWebhookApi(options);
    await assert.rejects(ensureProjectWebhookHook({ ...ensureOptions, request: api.request }), /could not be verified|still missing/);
  }
  assert.equal(hasActualsWebhookCoverage([]), false);
  const triggers = ["Timecards", "Manpower Logs"].flatMap((resource_name) =>
    ["CREATE", "UPDATE", "DELETE"].map((event_type) => ({ resource_name, event_type })));
  assert.equal(hasActualsWebhookCoverage(triggers), true);
  assert.equal(hasActualsWebhookCoverage(triggers.slice(1)), false);
});

test("interrupted webhook claims recover with ownership fencing and a bounded retry budget", async () => {
  const old = new Date(now.getTime() - 20 * 60_000);
  const records = [
    { id: "retry", status: "processing", lockedAt: old, lockedBy: "old", attempts: 1, maxAttempts: 5 },
    { id: "exhausted", status: "processing", lockedAt: old, lockedBy: "old", attempts: 5, maxAttempts: 5 },
    { id: "raced", status: "processing", lockedAt: old, lockedBy: "old", attempts: 1, maxAttempts: 5 },
  ];
  const db = { procoreWebhookQueue: {
    findMany: async (query) => {
      assert.equal(query.where.status, "processing");
      assert.equal(query.where.OR[0].lockedAt.lt.toISOString(), "2026-09-09T15:45:00.000Z");
      const snapshot = structuredClone(records);
      records[2].lockedBy = "new-worker";
      return snapshot;
    },
    updateMany: async ({ where, data }) => {
      const row = records.find((r) => r.id === where.id && r.status === where.status && r.lockedBy === where.lockedBy);
      if (!row) return { count: 0 };
      Object.assign(row, data);
      return { count: 1 };
    },
  } };
  assert.deepEqual(await recoverStaleWebhookClaims(db, now), { recovered: 1, failed: 1 });
  assert.equal(records[0].status, "pending");
  assert.equal(records[0].attempts, 1);
  assert.equal(records[1].status, "failed");
  assert.equal(records[2].lockedBy, "new-worker");
  assert.equal(records[2].status, "processing");
});

test("health respects intentional polling intervals and reports failed webhook setup", () => {
  const snapshot = { datasets: [
    { dataset: "actuals", never_succeeded: 0, failed_projects: 0, max_failure_count: 0,
      due_projects: 0, oldest_due: null, newest_success: "2026-09-09T10:00:00Z" },
  ], webhookQueue: [], projectReconciliation: { last_success_at: now, last_attempt_at: now } };
  assert.deepEqual(evaluateProcoreSyncHealth(snapshot, now), []);
  snapshot.datasets.push({ dataset: "project_webhooks", never_succeeded: 1, failed_projects: 1,
    max_failure_count: 3, newest_success: null });
  assert.deepEqual(evaluateProcoreSyncHealth(snapshot, now), ["1 project webhook registration job(s) are repeatedly failing."]);
});

test("worker wiring keeps dry runs read-only and webhook registration on its own durable queue", async () => {
  const processor = await readFile(new URL("../src/app/api/webhooks/procore/process/route.ts", import.meta.url), "utf8");
  const maintenance = await readFile(new URL("../src/lib/procoreWebhookMaintenance.ts", import.meta.url), "utf8");
  assert.match(processor, /dryRun \? \{ recovered: 0, failed: 0 \} : await recoverStaleWebhookClaims/);
  assert.match(processor, /where: \{ id: queueItem\.id, status: 'processing', lockedBy: workerId \}/);
  assert.match(processor, /withProcoreConnection\(worker\.connection, \(\) => releaseProcoreWorker\(worker\.companyId, worker\.leaseId\)/);
  assert.match(maintenance, /PROJECT_WEBHOOK_DATASET = "project_webhooks"/);
  assert.match(maintenance, /skipDuplicates: true/);
  assert.match(maintenance, /await deferProjectSync\(\{ project, until, result: detail \}\)/);
  assert.match(maintenance, /success: false, nextRunMinutes: 30/);
});

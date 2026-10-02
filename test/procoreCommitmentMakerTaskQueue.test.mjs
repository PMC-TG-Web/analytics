import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadModule(prisma = {}) {
  const source = fs.readFileSync("src/lib/procoreCommitmentMakerTaskQueue.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const require = (id) => {
    if (id === "@/lib/prisma") return { prisma };
    if (id === "@/lib/procoreCommitmentMakerTaskRunner") {
      return { runCommitmentMakerChangeOrderTasks: async () => ({}) };
    }
    throw new Error(`Unexpected import: ${id}`);
  };
  vm.runInNewContext(`(function(require, module, exports) { ${output} })(require, module, module.exports);`, {
    require,
    module,
  });
  return module.exports;
}

test("commitment task jobs are isolated by source change order", () => {
  const { commitmentMakerTaskDataset } = loadModule();
  assert.equal(commitmentMakerTaskDataset("598134327052229"), "commitment_maker_tasks:598134327052229");
  assert.equal(
    commitmentMakerTaskDataset("598134327052229", ["commitment_verification"]),
    "commitment_maker_tasks:598134327052229:commitment_verification",
  );
});

test("commitment task retries back off and cap at one hour", () => {
  const { commitmentMakerTaskRetryDelayMinutes } = loadModule();
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map(commitmentMakerTaskRetryDelayMinutes),
    [5, 10, 20, 40, 60, 60],
  );
});

test("maker durably queues follow-up tasks before best-effort background dispatch", () => {
  const source = fs.readFileSync("src/app/api/procore/commitments-live/maker/route.ts", "utf8");
  const queue = source.indexOf("await enqueueCommitmentMakerTasks");
  const dispatch = source.indexOf("/api/background/commitment-maker-tasks", queue);

  assert.ok(queue > 0);
  assert.ok(dispatch > queue);
  assert.match(source.slice(queue, dispatch), /taskKinds: \["aia_billing"\]/);
  assert.doesNotMatch(source, /ensureCommitmentMakerChangeOrderTasks/);
  assert.match(source.slice(dispatch, dispatch + 500), /AbortSignal\.timeout\(3_000\)/);
});

test("dedicated scheduler drains commitment task jobs every five minutes", () => {
  const source = fs.readFileSync("netlify/functions/commitment-maker-tasks-scheduled.mts", "utf8");

  assert.match(source, /\/api\/cron\/commitment-maker-tasks/);
  assert.match(source, /"x-sync-secret": syncSecret/);
  assert.match(source, /schedule: "\*\/5 \* \* \* \*"/);
});

test("five-minute sync polls change-order approvals before dispatching task jobs", () => {
  const source = fs.readFileSync("netlify/functions/scheduled-sync.mts", "utf8");
  const approvalPoll = source.indexOf("/api/background/change-order-approvals");
  const taskDispatch = source.indexOf("/api/background/commitment-maker-tasks");

  assert.ok(approvalPoll > 0);
  assert.ok(taskDispatch > approvalPoll);
});


test("PCCO approval queues billing independently of verification without a commitment", async () => {
  const saved = new Map();
  const { enqueueCommitmentMakerApprovalTasks } = loadModule({
    procoreSyncProjectState: { upsert: async (args) => {
      saved.set(args.where.companyId_projectId_dataset.dataset, args.create);
    } },
  });
  const params = { companyId: "company", projectId: "project",
    changeOrder: { packageId: "42", number: "002", title: "Approved PCCO", amount: 100 },
    userEmail: "worker@example.invalid", sourceKind: "change_order_package" };
  await enqueueCommitmentMakerApprovalTasks(params);
  await enqueueCommitmentMakerApprovalTasks(params);
  assert.equal(saved.size, 2);
  for (const kind of ["aia_billing", "commitment_verification"]) {
    const job = saved.get(`commitment_maker_tasks:42:${kind}`);
    assert.deepEqual(Array.from(job.lastResult.taskKinds), [kind]);
    assert.equal(job.lastResult.commitmentChangeOrderId, undefined);
  }
});

test("PCO approval retains verification only, avoiding premature PCCO billing", async () => {
  const saved = [];
  const { enqueueCommitmentMakerApprovalTasks } = loadModule({
    procoreSyncProjectState: { upsert: async (args) => saved.push(args.create) },
  });
  await enqueueCommitmentMakerApprovalTasks({ companyId: "company", projectId: "project",
    changeOrder: { packageId: "43" }, userEmail: "worker@example.invalid",
    sourceKind: "potential_change_order" });
  assert.equal(saved.length, 1);
  assert.deepEqual(Array.from(saved[0].lastResult.taskKinds), ["commitment_verification"]);
});

test("partial approval enqueue failure propagates and safely resumes the same jobs", async () => {
  const saved = new Map();
  let failVerification = true;
  const { enqueueCommitmentMakerApprovalTasks } = loadModule({
    procoreSyncProjectState: { upsert: async (args) => {
      const key = args.where.companyId_projectId_dataset.dataset;
      if (failVerification && key.endsWith(":commitment_verification")) throw new Error("database unavailable");
      saved.set(key, args.create);
    } },
  });
  const params = { companyId: "company", projectId: "project", changeOrder: { packageId: "42" },
    userEmail: "worker@example.invalid", sourceKind: "change_order_package" };
  await assert.rejects(enqueueCommitmentMakerApprovalTasks(params), /database unavailable/);
  assert.equal(saved.size, 1);
  assert.ok(saved.has("commitment_maker_tasks:42:aia_billing"));
  failVerification = false;
  await enqueueCommitmentMakerApprovalTasks(params);
  assert.equal(saved.size, 2);
});

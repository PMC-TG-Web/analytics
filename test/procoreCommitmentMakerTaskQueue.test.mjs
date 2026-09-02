import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";

function loadModule() {
  const source = fs.readFileSync("src/lib/procoreCommitmentMakerTaskQueue.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const require = (id) => {
    if (id === "@/lib/prisma") return { prisma: {} };
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

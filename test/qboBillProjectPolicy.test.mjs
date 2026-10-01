import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as policy from '../src/lib/qboBillProjectPolicy.ts';
import * as batch from '../src/lib/qboBillBatch.ts';

const companyId = '598134325805519';
const projectId = '598134326626273';
function moduleFromFile(file, imports) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, { exports: m.exports, require: id => imports[id], Date, Error });
  return m.exports;
}
test('PMC Operations exclusion follows its canonical company/project IDs across renames', () => {
  const rows = [{ procoreProjectId: projectId, projectName: 'Renamed operations' }, { procoreProjectId: '123', projectName: 'PMC Operations' }];
  assert.deepEqual(policy.eligibleBillProjects(companyId, rows), [rows[1]]);
  assert.deepEqual(policy.eligibleBillProjects('another-company', rows), rows);
  assert.throws(() => policy.assertBillProjectEligible(companyId, projectId), /excluded from direct-cost bills/);
  assert.equal(batch.batchTerminal('skipped'), true);
});
test('direct preview/setup/post drafts reject PMC Operations before reading sources or contacting integrations', async () => {
  const loader = moduleFromFile('src/lib/loadQboDirectCosts.ts', { './qboBillProjectPolicy': policy });
  await assert.rejects(loader.loadQboDirectCosts(companyId, projectId, '2026-06'), /excluded from direct-cost bills/);
});
test('monthly worklist omits Operations even with active sources and an existing host mapping', async () => {
  const reviewed = [];
  const prisma = {
    pmcProject: { findMany: async () => [{ procoreProjectId: projectId, projectName: 'PMC Operations' }, { procoreProjectId: '123', projectName: 'Real job' }] },
    productivityLog: { findMany: async () => [{ procoreProjectId: projectId }] },
    timecardEntry: { findMany: async () => [] }, qboBillFoodTotal: { findMany: async () => [] },
  };
  const queue = moduleFromFile('src/lib/loadQboBillQueue.ts', {
    './prisma': { prisma }, './qboBillProjectPolicy': policy,
    './qboDirectCosts': { directCostMonth: () => ({ start: new Date(), end: new Date() }) },
    './loadQboCostCatalog': { loadQboCostCatalog: async () => null },
    './qboBillBridge': { hasQboBillBridge: () => true, requestQboBillBridge: async () => ({ projectIds: [projectId, '123'] }) },
    './loadQboBillReview': { loadQboBillReview: async (_c, id) => { reviewed.push(id); return { billId: null }; } },
  });
  const result = await queue.loadQboBillQueue(companyId, '2026-06');
  assert.deepEqual(Array.from(result.rows, row => row.projectId), ['123']);
  assert.deepEqual(reviewed, ['123']);
});
test('saved queued Operations projects skip every stage without external work, preserving uncertain saves for review', async () => {
  for (const stage of batch.batchStages) {
    for (const writeStartedAt of [null, new Date()]) {
      const item = { projectId, stage, attempts: 0, context: {}, writeStartedAt };
      const saves = []; let finished = 0;
      const worker = moduleFromFile('src/lib/runQboBillBatch.ts', {
        './prisma': { prisma: { qboBillBatchProject: { findFirst: async () => item } } },
        './qboBillProjectPolicy': policy, './qboBillBatch': batch,
        './qboBillBatchStore': {
          billBatchEnabled: () => true,
          claimBillBatch: async () => ({ id: 'run', companyId, month: '2026-06', leaseToken: 'token', createdAt: new Date() }),
          saveBillBatchStep: async (...args) => saves.push(args[4]),
          finishBillBatchTick: async () => { finished++; },
        },
      });
      const result = await worker.runQboBillBatchTick();
      assert.equal(result.status, writeStartedAt ? 'needs_attention' : 'skipped');
      assert.equal(saves.length, 1); assert.equal(finished, 1);
      assert.equal(saves[0].clearWrite, undefined);
      assert.match(saves[0].message, writeStartedAt ? /previous save requires reconciliation/ : /^Skipped:/);
    }
  }
});

test('queue pagination limits draft work and status reads to four canonical projects per request', async () => {
  const projects = Array.from({ length: 9 }, (_, i) => ({ procoreProjectId: String(100 + i), projectName: `Job ${i}`, projectNumber: String(i) }));
  const drafted = [], reviewed = [], timeouts = [];
  const queue = moduleFromFile('src/lib/loadQboBillQueue.ts', {
    './prisma': { prisma: {
      pmcProject: { findMany: async () => projects.toReversed() },
      productivityLog: { findMany: async () => projects }, timecardEntry: { findMany: async () => [] }, qboBillFoodTotal: { findMany: async () => [] },
    } }, './qboBillProjectPolicy': policy,
    './qboDirectCosts': { directCostMonth: () => ({ start: new Date(), end: new Date() }) },
    './loadQboCostCatalog': { loadQboCostCatalog: async () => null },
    './qboBillBridge': { hasQboBillBridge: () => true, requestQboBillBridge: async (_body, timeout) => { timeouts.push(timeout); return { projectIds: [] }; } },
    './loadQboDirectCosts': { loadQboDirectCosts: async (_c, id) => { drafted.push(id); return { lines: [], total: '0.00', labor: { combinedHours: '0' }, issues: [] }; } },
    './loadQboBillReview': { loadQboBillReview: async (_c, id, _month, draft, prepare, timeout) => { reviewed.push(id); assert.ok(draft); assert.equal(prepare, false); assert.equal(timeout, 8000); return { billId: null, issues: [] }; } },
  });
  let after = null; const ids = [];
  do {
    const page = await queue.loadQboBillQueue(companyId, '2026-06', { after });
    assert.ok(page.rows.length <= 4); assert.equal(page.totalProjects, 9);
    ids.push(...page.rows.map(r => r.projectId)); after = page.nextCursor;
  } while (after);
  assert.deepEqual(ids, projects.map(p => p.procoreProjectId));
  assert.equal(drafted.length, 9); assert.equal(reviewed.length, 9, 'Active projects need only one status read');
  assert.deepEqual(timeouts, [8000, 8000, 8000]);
  await assert.rejects(queue.loadQboBillQueue(companyId, '2026-06', { after: '999' }), /project list changed/);
});

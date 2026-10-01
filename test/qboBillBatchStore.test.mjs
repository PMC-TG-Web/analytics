import * as projectPolicy from '../src/lib/qboBillProjectPolicy.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as batch from '../src/lib/qboBillBatch.ts';

function store({ enabled = true, runs = [], lostLease = false, maxProjects = '2', companyId = '1', projects = [{ procoreProjectId: '10', projectName: 'Same name' }, { procoreProjectId: '20', projectName: 'Same name' }] } = {}) {
  let projectUpdates = 0;
  const matches = (r, w) => (!w.id || r.id === w.id) && (!w.companyId || r.companyId === w.companyId) && (!w.month || r.month === w.month) && (!w.status || r.status === w.status) && (!w.activeKey || r.activeKey === w.activeKey) && (!w.leaseToken || r.leaseToken === w.leaseToken) && (!w.companyId_requestKey || r.companyId === w.companyId_requestKey.companyId && r.requestKey === w.companyId_requestKey.requestKey) && (!w.OR || !r.leaseUntil || r.leaseUntil < new Date());
  const prisma = {
    pmcProject: { findMany: async () => projects },
    qboBillBatchRun: {
      findUnique: async ({ where }) => runs.find(r => matches(r, where)) || null,
      findFirst: async ({ where }) => { const r = runs.find(r => matches(r, where)); return r ? { ...r } : null; },
      create: async ({ data }) => {
        if (runs.some(r => r.activeKey === data.activeKey || r.companyId === data.companyId && r.requestKey === data.requestKey)) throw new Prisma.PrismaClientKnownRequestError('Duplicate', { code: 'P2002', clientVersion: 'test' });
        const r = { ...data, id: randomUUID(), status: 'running', projects: data.projects.create, createdAt: new Date() }; runs.push(r); return r;
      },
      updateMany: async ({ where, data }) => { const r = lostLease ? null : runs.find(r => matches(r, where)); if (!r) return { count: 0 }; Object.assign(r, data); return { count: 1 }; },
    },
    qboBillBatchProject: { update: async () => { projectUpdates++; }, count: async () => 0 },
  };
  prisma.$transaction = async work => work(prisma);
  const imports = { './qboBillProjectPolicy': projectPolicy, 'node:crypto': { randomUUID }, '@prisma/client': { Prisma }, './prisma': { prisma }, './qboBillBatch': batch };
  const js = ts.transpileModule(fs.readFileSync('src/lib/qboBillBatchStore.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} }; vm.runInNewContext(js, { exports: m.exports, require: id => imports[id], process: { env: { PROCORE_COMPANY_ID: companyId, QBO_BILL_BATCH_ENABLED: String(enabled), QBO_BILL_BATCH_MAX_PROJECTS: maxProjects } } });
  return { ...m.exports, runs, updates: () => projectUpdates };
}
const start = (s, key = randomUUID(), month = '2026-09', retryOf) => s.startBillBatch('1', month, 'operator@example.test', key, retryOf, retryOf ? undefined : ['10', '20']);

test('Operations is unavailable in batch options, forged selections and retries of old failures', async () => {
  const companyId = '598134325805519', projectId = '598134326626273';
  const s = store({ companyId, projects: [{ procoreProjectId: projectId, projectName: 'PMC Operations' }, { procoreProjectId: '10', projectName: 'Real job' }],
    runs: [{ id: 'prior', companyId, month: '2026-06', status: 'complete', projects: [{ projectId, status: 'needs_attention' }, { projectId: '10', status: 'needs_attention' }] }] });
  assert.deepEqual(Array.from(await s.billBatchProjectOptions(companyId), p => p.procoreProjectId), ['10']);
  await assert.rejects(s.startBillBatch(companyId, '2026-06', 'actor', randomUUID(), undefined, [projectId]), /unavailable/);
  const retry = await s.startBillBatch(companyId, '2026-06', 'actor', randomUUID(), 'prior');
  assert.deepEqual(Array.from(retry.projects, p => p.projectId), ['10']);
});
test('concurrent starts create one company run and preserve canonical IDs for same-name projects', async () => {
  const s = store(); const results = await Promise.all([start(s), start(s)]);
  assert.equal(s.runs.length, 1); assert.equal(results[0].id, results[1].id);
  assert.deepEqual(Array.from(s.runs[0].projects, p => p.projectId), ['10', '20']);
});
test('request keys remain idempotent after completion and cannot change months', async () => {
  const s = store(); const key = randomUUID(); const first = await start(s, key);
  first.activeKey = null; first.status = 'complete';
  assert.equal((await start(s, key)).id, first.id); assert.equal(s.runs.length, 1);
  await assert.rejects(start(s, key, '2026-08'), /different month/);
});
test('a second month cannot overlap an active company batch', async () => {
  const s = store(); const first = await start(s);
  assert.equal((await start(s, randomUUID(), '2026-08')).id, first.id); assert.equal(s.runs.length, 1);
});
test('retry selects only unresolved source IDs from the same company and month', async () => {
  const s = store({ runs: [{ id: 'prior', companyId: '1', month: '2026-09', status: 'complete', activeKey: null, projects: [{ projectId: '20', status: 'needs_attention' }] }] });
  const run = await start(s, randomUUID(), '2026-09', 'prior');
  assert.deepEqual(Array.from(run.projects, p => p.projectId), ['20']);
  const other = store({ runs: [{ id: 'prior', companyId: '2', month: '2026-09', status: 'complete' }] });
  await assert.rejects(start(other, randomUUID(), '2026-09', 'prior'), /completed run/);
});
test('only one worker claims a run and a stale lease cannot persist or mark a write', async () => {
  const s = store(); await start(s); const claimed = await Promise.all([s.claimBillBatch(), s.claimBillBatch()]);
  assert.equal(claimed.filter(Boolean).length, 1);
  const stale = store({ lostLease: true });
  await assert.rejects(stale.markBatchWrite('run', 'old-token', '10'), /lease expired/);
  await assert.rejects(stale.saveBillBatchStep('run', 'old-token', '10', 'review', { status: 'updated', message: 'Saved' }), /lease expired/);
  assert.equal(stale.updates(), 0);
});
test('disabled batches and invalid scopes cannot create a run', async () => {
  const s = store({ enabled: false }); await assert.rejects(start(s), /not enabled/); assert.equal(s.runs.length, 0);
  const enabled = store(); await assert.rejects(enabled.startBillBatch('2', '2026-09', 'actor', randomUUID()), /valid company/);
  await assert.rejects(start(enabled, randomUUID(), '2026-13'), /valid company/);
});
test('pilot defaults to one project and rejects implicit, invalid, duplicate or foreign selection', async () => {
  for (const maxProjects of [undefined, '', '0', '1oops', '101']) {
    const s = store({ maxProjects: maxProjects ?? '' });
    assert.equal(s.billBatchMaxProjects(), 1);
    for (const ids of [undefined, null, [], ['10', '20'], ['10', '10'], ['999'], [10]]) {
      await assert.rejects(s.startBillBatch('1', '2026-09', 'operator', randomUUID(), undefined, ids));
    }
    assert.equal(s.runs.length, 0);
    const run = await s.startBillBatch('1', '2026-09', 'operator', randomUUID(), undefined, ['20']);
    assert.deepEqual(Array.from(run.projects, p => p.projectId), ['20']);
  }
});
test('request id cannot change project selection and retry cannot bypass the cap', async () => {
  const s = store(); const key = randomUUID();
  const run = await s.startBillBatch('1', '2026-09', 'operator', key, undefined, ['10']);
  run.status = 'complete'; run.activeKey = null;
  await assert.rejects(s.startBillBatch('1', '2026-09', 'operator', key, undefined, ['20']), /different project selection/);
  const limited = store({ maxProjects: '1', runs: [{ id: 'prior', companyId: '1', month: '2026-09', status: 'complete', projects: [{ projectId: '10', status: 'needs_attention' }, { projectId: '20', status: 'needs_attention' }] }] });
  await assert.rejects(start(limited, randomUUID(), '2026-09', 'prior'), /project limit/);
  const retry = await limited.startBillBatch('1', '2026-09', 'operator', randomUUID(), 'prior', ['10']);
  assert.deepEqual(Array.from(retry.projects, p => p.projectId), ['10']);
});

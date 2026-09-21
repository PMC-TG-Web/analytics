import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';
import * as maker from '../src/lib/procore/commitmentMaker.ts';
import { runCommitmentMakerRequest } from '../src/lib/commitmentMakerRequest.ts';

class PrimaryEstimateError extends Error {}
class CommitmentMakerRateLimitError extends Error {
  constructor(until) { super('cooldown'); this.rateLimitUntil = new Date(until).toISOString(); }
}
function fixture() {
  const rows = new Map();
  let time = Date.now();
  const prisma = {
    $queryRaw: async (sql, id, companyId, projectId, boardId, mode) => {
      if (sql.join('').includes('procore_commitment_estimate_caches')) return [];
      const row = rows.get(id);
      return row && row.companyId === companyId && row.projectId === projectId && row.boardId === boardId && row.mode === mode
        ? [{ state: structuredClone(row.state) }] : [];
    },
    $executeRaw: async (sql, ...args) => {
      if (sql.join('').includes('procore_commitment_estimate_caches')) return 1;
      if (sql.join('').includes('INSERT')) {
        const [id, companyId, projectId, boardId, mode, state] = args;
        rows.set(id, { companyId, projectId, boardId, mode, state: JSON.parse(state) });
      } else {
        const [patch, id] = args;
        const row = rows.get(id);
        if (sql.join('').includes('jsonb_set')) Object.assign(row.state.responses, JSON.parse(patch));
        else Object.assign(row.state, JSON.parse(patch));
      }
      return 1;
    },
  };
  const deps = { 'node:crypto': { randomUUID }, '@/lib/prisma': { prisma },
    '@/lib/procoreCommitmentMakerClient': { CommitmentMakerRateLimitError },
    '@/lib/procore/commitmentMakerEstimate': { PrimaryEstimateError } };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync('src/lib/procoreCommitmentEstimateRead.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(id => deps[id], module, module.exports);
  const options = { companyId: 'company', projectId: 'project', boardId: 'board', mode: 'preview', now: () => time };
  return { ...module.exports, prisma, options, advance: ms => { time += ms; }, now: () => time };
}

test('checkpoints each read and continues without replaying the completed pages or catalog items', async () => {
  const f = fixture();
  let calls = 0;
  const load = async () => ({ value: ++calls });
  const first = await f.openCommitmentEstimateRead(f.options);
  for (let i = 0; i < 4; i++) await first.read(`item/${i}`, load);
  await assert.rejects(first.read('item/4', load), error => error instanceof f.EstimateReadPending && error.preparationId === first.id);
  const resumed = await f.openCommitmentEstimateRead({ ...f.options, preparationId: first.id });
  for (let i = 0; i < 5; i++) assert.deepEqual(await resumed.read(`item/${i}`, load), { value: i + 1 });
  assert.equal(calls, 5);
  await assert.rejects(resumed.complete({ proposal: { id: 'primary' } }), f.EstimateReadPending);
  const ready = await f.openCommitmentEstimateRead({ ...f.options, preparationId: first.id });
  assert.deepEqual(ready.snapshot, { proposal: { id: 'primary' } });
});

test('slow reads yield early; a provider cooldown preserves completed work and its reset time', async () => {
  const f = fixture();
  const first = await f.openCommitmentEstimateRead(f.options);
  await first.read('one', async () => { f.advance(5_001); return 'saved'; });
  await assert.rejects(first.read('two', async () => assert.fail('must yield before another call')), f.EstimateReadPending);
  const resumed = await f.openCommitmentEstimateRead({ ...f.options, preparationId: first.id });
  assert.equal(await resumed.read('one', async () => assert.fail('must not refetch')), 'saved');
  const reset = f.now() + 60_000;
  await assert.rejects(resumed.read('two', async () => { throw new CommitmentMakerRateLimitError(reset); }),
    error => error instanceof f.EstimateReadPending && error.resumeAt === reset && error.preparationId === first.id);
  await assert.rejects(resumed.read('three', async () => { throw new Error('malformed'); }), /malformed/);
});

test('preparation is bound to exact company, project, board and preview/create mode', async () => {
  const f = fixture();
  const first = await f.openCommitmentEstimateRead(f.options);
  for (const field of ['companyId', 'projectId', 'boardId', 'mode']) {
    await assert.rejects(f.openCommitmentEstimateRead({ ...f.options, preparationId: first.id, [field]: 'other' }), /another request/);
  }
  await assert.rejects(f.openCommitmentEstimateRead({ ...f.options, preparationId: 'invalid' }), /Invalid/);
  await assert.rejects(first.complete({}), f.EstimateReadPending);
  f.advance(5 * 60_000 + 1);
  await assert.rejects(f.openCommitmentEstimateRead({ ...f.options, preparationId: first.id }), /prepared estimate expired/);
});

test('a slow 53-item preview completes across HTTP continuations without rereading finished catalog items', async () => {
  const f = fixture();
  function load(file, dependencies) {
    const module = { exports: {} };
    new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(file, 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(id => dependencies[id], module, module.exports);
    return module.exports;
  }
  const logic = load('src/lib/procore/commitmentMakerEstimate.ts', { './commitmentMaker': maker });
  const primary = { id: 'primary', type: 'ESTIMATE', is_primary: true, updated_at: 'unchanged' };
  const lines = Array.from({ length: 53 }, (_, i) => ({ id: String(i + 1), name: `Item ${i}`, group_id: 'g1', quantity: 1,
    item_cost: 10, cost_item: { id: String(i + 100), unit: 'EA', unit_cost: 10 } }));
  const catalogCalls = [];
  let requestCalls = 0;
  const requestDurations = [];
  const source = load('src/lib/procoreCommitmentMakerEstimateSource.ts', {
    '@/lib/prisma': { prisma: { ...f.prisma,
      pmcProject: { findUnique: async () => ({ bidBoardId: '123' }) },
      pmcBidBoardProject: { findMany: async () => [] }, procoreEstimateProposal: { findMany: async () => [] } } },
    '@/lib/procore/commitmentMakerEstimate': logic,
    '@/lib/procoreCommitmentEstimateRead': { openCommitmentEstimateRead: options => f.openCommitmentEstimateRead({ ...options, now: f.now }) },
    '@/lib/procoreCommitmentMakerClient': { commitmentMakerProcoreJson: async ({ path }) => {
      f.advance(2_000);
      let payload;
      if (path.includes('/catalogs/items/')) {
        const id = path.split('/').at(-1);
        catalogCalls.push(id);
        payload = { id, cost_code: '03-300-00-20', cost_type_code: 'CON' };
      } else if (path.includes('/line_items?')) payload = lines;
      else if (path.includes('/line_item_groups?')) payload = [{ id: 'g1', name: 'Slabs' }];
      else payload = [primary];
      return { ok: true, status: 200, payload };
    } },
  });
  const result = await runCommitmentMakerRequest({ signal: new AbortController().signal, now: f.now,
    wait: async ms => f.advance(ms), onResponse: () => {}, request: async preparationId => {
      requestCalls += 1;
      const started = f.now();
      try {
        const snapshot = await source.readPrimaryCommitmentEstimate({ companyId: 'company', projectId: 'project',
          mode: 'preview', forceLive: true, preparationId, getToken: async () => 'test' });
        const parsed = logic.parsePrimaryCommitmentEstimate(snapshot.lines, snapshot.groups);
        return Response.json({ success: true, lines: parsed.groups[0].lineItems.length,
          total: parsed.groups[0].lineItems.reduce((sum, line) => sum + maker.commitmentMakerLineAmount(line), 0) });
      } catch (error) {
        if (!(error instanceof f.EstimateReadPending)) throw error;
        return Response.json({ preparing: true, retryable: true, preparationId: error.preparationId,
          resumeAt: new Date(error.resumeAt).toISOString() }, { status: 202 });
      } finally { requestDurations.push(f.now() - started); }
    } });
  assert.deepEqual(result.payload, { success: true, lines: 53, total: 530 });
  assert.equal(catalogCalls.length, 53);
  assert.equal(new Set(catalogCalls).size, 53);
  assert.ok(requestCalls > 10);
  assert.ok(requestDurations.every(ms => ms <= 6_000));
});

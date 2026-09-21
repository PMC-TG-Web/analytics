import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';

class PrimaryEstimateError extends Error {}
class CommitmentMakerRateLimitError extends Error {
  constructor(until) { super('cooldown'); this.rateLimitUntil = new Date(until).toISOString(); }
}
function fixture() {
  const rows = new Map();
  let time = Date.now();
  const prisma = {
    $queryRaw: async (_sql, id, companyId, projectId, boardId, mode) => {
      const row = rows.get(id);
      return row && row.companyId === companyId && row.projectId === projectId && row.boardId === boardId && row.mode === mode
        ? [{ state: structuredClone(row.state) }] : [];
    },
    $executeRaw: async (sql, ...args) => {
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
  return { ...module.exports, options, advance: ms => { time += ms; }, now: () => time };
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

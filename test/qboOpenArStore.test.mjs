import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { arFixture } from './fixtures/qboOpenAr.mjs';
const state = { payload: arFixture(), saved: null, writes: [], reads: [], requests: [], jobState: 'succeeded', jobError: null, existing: null };
process.env.QBO_BILL_RELAY_ENABLED = 'true';
globalThis.__openArStore = {
  prisma: { qboOpenArSnapshot: {
    findFirst: async args => { state.reads.push(args); return state.saved; },
    upsert: async args => { state.writes.push(args); return args.create; },
  }, qboBillRelayJob: {
    findFirst: async args => {
      assert.equal(args.where.companyId, '123');
      assert.equal(args.where.operation, 'open-ar');
      return args.where.id ? { id: args.where.id, state: state.jobState, result: state.payload, error: state.jobError, expiresAt: new Date(Date.now() + 300000) } : state.existing;
    },
  } },
  enqueueQboBillRelay: async (request, timeout) => { state.requests.push([request, timeout]); return { id: 'job' }; },
};
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/loadQboOpenAr.ts')) {
    if (specifier === './prisma') return next('data:text/javascript,export const prisma=globalThis.__openArStore.prisma;', context);
    if (specifier === './qboBillRelay') return next('data:text/javascript,export const {enqueueQboBillRelay}=globalThis.__openArStore;', context);
    if (specifier === './qboOpenAr') return next(new URL('../src/lib/qboOpenAr.ts', import.meta.url).href, context);
  }
  return next(specifier, context);
} });
const { loadQboOpenAr, queueQboOpenAr, completeQboOpenAr } = await import('../src/lib/loadQboOpenAr.ts');
test('ordinary reads use only saved company-scoped snapshots and explicitly return no snapshot', async () => {
  assert.equal(await loadQboOpenAr('123'), null);
  assert.deepEqual(state.reads[0].where, { companyId: '123' });
  assert.equal(state.requests.length, 0);
  state.saved = { payload: arFixture() };
  assert.equal((await loadQboOpenAr('123')).invoices.length, 5);
});
test('refresh queues a bounded read, reuses active work and imports completed results idempotently', async () => {
  assert.deepEqual(await queueQboOpenAr('123'), { id: 'job', state: 'queued' });
  assert.deepEqual(state.requests[0], [{ operation: 'open-ar', companyId: '123' }, 300000]);
  state.existing = { id: 'existing' };
  assert.deepEqual(await queueQboOpenAr('123'), { id: 'existing', state: 'queued' });
  assert.equal(state.requests.length, 1);
  state.existing = null;
  state.jobState = 'processing';
  assert.equal((await completeQboOpenAr('123', 'job')).report, null);
  assert.equal(state.writes.length, 0);
  state.jobState = 'succeeded';
  await completeQboOpenAr('123', 'job'); await completeQboOpenAr('123', 'job');
  assert.deepEqual(state.writes[0].update, {});
  assert.equal(state.writes[0].where.sourceHash, state.writes[1].where.sourceHash);
  assert.equal(state.writes[0].create.realmId, '456');
  assert.equal(state.writes[0].create.payload.invoices.length, 5);
});
test('invalid, mismatched and unavailable sources never replace the previous snapshot', async () => {
  const before = state.writes.length;
  state.payload = { ...arFixture(), companyId: 'other' };
  await assert.rejects(completeQboOpenAr('123', 'job'), /different company/);
  state.payload = {};
  await assert.rejects(completeQboOpenAr('123', 'job'), /Unsupported/);
  state.jobState = 'failed';
  await assert.rejects(completeQboOpenAr('123', 'job'), /failed or expired/);
  state.jobError = 'Foreign-currency receivables require conversion before this report can be refreshed.';
  await assert.rejects(completeQboOpenAr('123', 'job'), /Foreign-currency/);
  process.env.QBO_BILL_RELAY_ENABLED = 'false';
  await assert.rejects(queueQboOpenAr('123'), /not configured/);
  assert.equal(state.writes.length, before);
});

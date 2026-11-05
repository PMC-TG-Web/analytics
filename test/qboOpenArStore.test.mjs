import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { arFixture } from './fixtures/qboOpenAr.mjs';
const state = { payload: arFixture(), saved: null, writes: [], reads: [], requests: [], jobState: 'succeeded', jobError: null, existing: null, completed: null, latestJob: null, host: null, locks: 0, transactional: false, persistQueued: false };
let lane = Promise.resolve();
process.env.QBO_BILL_RELAY_ENABLED = 'true';
globalThis.__openArStore = {
  prisma: {
    $transaction: (run, options) => {
      assert.equal(options.timeout, 10000);
      const task = lane.then(async () => { state.transactional = true; try { return await run(globalThis.__openArStore.prisma); } finally { state.transactional = false; } });
      lane = task.catch(() => {}); return task;
    },
    $executeRaw: async (sql, key) => {
      assert.equal(state.transactional, true); assert.match(sql.join('?'), /pg_advisory_xact_lock/);
      assert.equal(key, 'qbo-open-ar:primary:123'); state.locks++; return 1;
    },
    qboBillRelayHost: { findUnique: async () => state.host },
    qboOpenArSnapshot: {
    findFirst: async args => { state.reads.push(args); return state.saved; },
    upsert: async args => { state.writes.push(args); return args.create; },
  }, qboBillRelayJob: {
    findFirst: async args => {
      assert.equal(args.where.companyId, '123');
      assert.equal(args.where.operation, 'open-ar');
      if (args.where.id) return { id: args.where.id, state: state.jobState, result: state.payload, error: state.jobError, expiresAt: new Date(Date.now() + 300000) };
      if (args.where.OR) {
        assert.deepEqual(args.where.OR[0], { state: 'processing' }, 'never replace a still-running read solely because its browser deadline passed');
        return state.existing;
      }
      if (args.where.state === 'succeeded') {
        assert.equal(args.where.createdAt.gte.getTime(), Math.floor(Date.now() / 3600000) * 3600000);
        return state.completed;
      }
      return state.latestJob;
    },
  } },
  enqueueQboBillRelay: async (request, timeout, database) => {
    assert.equal(state.transactional, true); assert.equal(database, globalThis.__openArStore.prisma);
    state.requests.push([request, timeout]);
    if (state.persistQueued) state.existing = { id: 'job' };
    return { id: 'job' };
  },
};
registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.endsWith('/loadQboOpenAr.ts')) {
    if (specifier === './prisma') return next('data:text/javascript,export const prisma=globalThis.__openArStore.prisma;', context);
    if (specifier === './qboBillRelay') return next('data:text/javascript,export const {enqueueQboBillRelay}=globalThis.__openArStore;', context);
    if (specifier === './qboOpenAr') return next(new URL('../src/lib/qboOpenAr.ts', import.meta.url).href, context);
  }
  return next(specifier, context);
} });
const { loadQboOpenAr, loadQboOpenArHealth, queueQboOpenAr, completeQboOpenAr } = await import('../src/lib/loadQboOpenAr.ts');
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
  process.env.QBO_BILL_RELAY_ENABLED = 'true';
});
test('scheduled/manual concurrency shares a transaction lock and reuses a single active read', async () => {
  state.persistQueued = true; state.existing = null;
  const before = state.requests.length;
  const results = await Promise.all([queueQboOpenAr('123', true), queueQboOpenAr('123'), queueQboOpenAr('123', true)]);
  assert.ok(results.every(result => result.id === 'job'));
  assert.equal(state.requests.length - before, 1);
  assert.ok(state.locks >= 3);
  state.persistQueued = false; state.existing = null;
});
test('duplicate scheduled ticks reuse this hour success but manual refresh remains available', async () => {
  state.completed = { id: 'completed-this-hour' };
  const before = state.requests.length;
  assert.deepEqual(await queueQboOpenAr('123', true), { id: 'completed-this-hour', state: 'succeeded' });
  assert.equal(state.requests.length, before);
  assert.equal((await queueQboOpenAr('123')).state, 'queued');
  assert.equal(state.requests.length, before + 1);
  state.completed = null;
});
test('health reports company-scoped offline, failed and expired reads without exposing payloads', async () => {
  let health = await loadQboOpenArHealth('123');
  assert.equal(health.hostOnline, false); assert.equal(health.latestRefresh, null);
  state.host = { companyId: '123', updatedAt: new Date() };
  state.latestJob = { state: 'failed', createdAt: new Date(), finishedAt: new Date(), expiresAt: new Date(Date.now() + 1000) };
  health = await loadQboOpenArHealth('123');
  assert.equal(health.hostOnline, true); assert.equal(health.latestRefresh.state, 'failed');
  state.latestJob.state = 'processing'; state.latestJob.expiresAt = new Date(Date.now() - 1);
  assert.equal((await loadQboOpenArHealth('123')).latestRefresh.state, 'expired');
  state.host.companyId = 'other';
  assert.equal((await loadQboOpenArHealth('123')).hostOnline, false);
});

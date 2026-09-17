import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const state = { host: null, result: null, error: null, created: [] };
globalThis.__qboRelayTestDb = {
  qboBillRelayHost: { findUnique: async () => state.host },
  qboBillRelayJob: {
    create: async ({ data }) => { state.created.push(data); return data; },
    findUnique: async () => ({ state: state.error ? 'failed' : 'succeeded', error: state.error, result: state.result }),
    updateMany: async () => ({ count: 1 }),
  },
};
registerHooks({ resolve(specifier, context, next) {
  if (specifier === './prisma' && context.parentURL?.endsWith('/qboBillRelay.ts')) return next('data:text/javascript,export const prisma=globalThis.__qboRelayTestDb;', context);
  return next(specifier, context);
} });
const { requestQboBillRelay } = await import('../src/lib/qboBillRelay.ts');

test('relay requires a live host for the exact company and never queues an offline write', async () => {
  const request = { operation: 'post', companyId: '2' };
  await assert.rejects(requestQboBillRelay(request), /offline/);
  state.host = { companyId: '99', updatedAt: new Date() };
  await assert.rejects(requestQboBillRelay(request), /offline/);
  state.host = { companyId: '2', updatedAt: new Date(Date.now() - 60_000) };
  await assert.rejects(requestQboBillRelay(request), /offline/);
  assert.equal(state.created.length, 0);
});
test('relay returns the worker result or explicit failure and records expiry', async () => {
  state.host = { companyId: '2', updatedAt: new Date() }; state.result = { billNumber: 'PMCDC001' };
  assert.equal((await requestQboBillRelay({ operation: 'prepare', companyId: '2' })).billNumber, 'PMCDC001');
  const job = state.created.at(-1);
  assert.equal(job.state, undefined); assert.equal(job.companyId, '2'); assert.ok(job.expiresAt > new Date());
  state.error = 'Reopen the review before posting.';
  await assert.rejects(requestQboBillRelay({ operation: 'post', companyId: '2' }), /Reopen/);
  state.error = null;
  state.result = { complete: false, remaining: 2 };
  for (const operation of ['setup-options', 'setup']) {
    assert.equal((await requestQboBillRelay({ operation, companyId: '2' })).remaining, 2);
    assert.equal(state.created.at(-1).operation, operation);
  }
  await assert.rejects(requestQboBillRelay({ operation: 'arbitrary', companyId: '2' }), /Invalid/);
});

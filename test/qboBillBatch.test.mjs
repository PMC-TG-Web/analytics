import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceBillBatch, batchError, batchTerminal, BatchWait } from '../src/lib/qboBillBatch.ts';

const draft = { projectName: 'Example', projectNumber: '2501', lines: [{ lineKey: '10' }], issues: [], issueSources: [] };
const ready = { connected: true, action: 'update', billId: '50', billNumber: 'Example 001', canPost: true, fingerprint: 'a'.repeat(64), issues: [], products: { 10: '2501-03-200-30-20.M' } };
const staleMapping = 'QBO product mapping for 2” plastic Chairs needs updating: saved product 2603 - WC-03-150-10-85.M must use 2603 - WC-03-200-50-30.<suffix>. Run Set up products to refresh the assignment.';
function fixture(overrides = {}) {
  const calls = [];
  const deps = { refresh: async s => calls.push(s), draft: async () => draft, review: async () => ready,
    options: async () => ({ customerId: '7', customers: [] }), customer: () => null,
    plan: async () => ({ products: ['2501-03-200-30-20.M'] }), budget: async () => ({ ready: true, message: 'Ready' }),
    setup: async () => ({ complete: true, remaining: 0 }), markWrite: async () => calls.push('intent'),
    post: async () => { calls.push('post'); return { billNumber: 'Example 001', updated: true }; }, ...overrides };
  return { deps, calls, item: { projectId: '2', stage: 'review', context: {}, attempts: 0 } };
}
test('an existing bill follows refresh, budget, prepare and a single save', async () => {
  const f = fixture(); let item = { ...f.item, stage: 'catalog' }; let result;
  for (let i = 0; i < 12; i++) { result = await advanceBillBatch(item, f.deps); if (batchTerminal(result.status)) break; item = { ...item, stage: result.stage, context: result.context }; }
  assert.equal(result.status, 'updated');
  assert.deepEqual(f.calls, ['catalog', 'purchase_orders', 'daily_logs', 'timecards', 'intent', 'post']);
});
test('new project sets up codes and products before preparing its full bill', async () => {
  let setup = false;
  const f = fixture({ review: async () => setup ? { ...ready, billId: null } : { ...ready, connected: false, billId: null, products: {} },
    setup: async () => { setup = true; return { complete: true, remaining: 0 }; }, post: async () => ({ billNumber: 'Example 001', updated: false }) });
  let item = f.item; const stages = []; let result;
  for (let i = 0; i < 12; i++) { stages.push(item.stage); result = await advanceBillBatch(item, f.deps); if (batchTerminal(result.status)) break; item = { ...item, stage: result.stage, context: result.context }; }
  assert.equal(result.status, 'created');
  assert.deepEqual(stages, ['review', 'setup_options', 'setup_budget', 'setup', 'review', 'bill_budget', 'prepare', 'post']);
});
test('already-current and empty months do not create codes, products or bills', async () => {
  for (const empty of [false, true]) {
    const f = fixture({ draft: async () => empty ? { ...draft, lines: [] } : draft, review: async () => ({ ...ready, action: empty ? 'no_activity' : 'current', billId: empty ? null : '50' }) });
    assert.equal((await advanceBillBatch(f.item, f.deps)).status, empty ? 'empty' : 'current');
    assert.deepEqual(f.calls, []);
  }
});
test('one unpriced line blocks the complete project and retains PO/date evidence', async () => {
  const bad = { ...draft, issues: ['Curing compound needs a price. PO-002; daily log 2026-09-12.'], issueSources: [{ purchaseOrderId: '44', date: '2026-09-12' }] };
  const f = fixture({ draft: async () => bad });
  const result = await advanceBillBatch(f.item, f.deps);
  assert.equal(result.status, 'needs_attention'); assert.deepEqual(result.issues, bad.issues); assert.deepEqual(result.issueSources, bad.issueSources); assert.deepEqual(f.calls, []);
  const healthy = fixture(); assert.equal((await advanceBillBatch(healthy.item, healthy.deps)).stage, 'bill_budget');
});
test('ambiguous customer and manual reconciliation require attention', async () => {
  const f = fixture({ options: async () => ({ customerId: null, customers: [] }) });
  assert.equal((await advanceBillBatch({ ...f.item, stage: 'setup_options' }, f.deps)).status, 'needs_attention');
  f.deps.review = async () => ({ ...ready, action: 'reconcile', issues: ['Manual QBO changes require review.'] });
  assert.equal((await advanceBillBatch(f.item, f.deps)).status, 'needs_attention'); assert.deepEqual(f.calls, []);
});
test('budget quota wait keeps the same stage and performs no QBO save', async () => {
  const f = fixture({ budget: async () => ({ ready: false, message: 'Waiting for capacity', retryAfterMs: 5000 }) });
  const result = await advanceBillBatch({ ...f.item, stage: 'bill_budget' }, f.deps);
  assert.equal(result.status, 'waiting'); assert.equal(result.stage, 'bill_budget'); assert.equal(result.retryMs, 5000); assert.deepEqual(f.calls, []);
});
test('only current source products are sent to the budget check', async () => {
  const f = fixture({ review: async () => ({ ...ready, products: { ...ready.products, obsolete: '2501-00-000-00-00.M' } }), budget: async (_draft, products) => { assert.deepEqual(products, [ready.products[10]]); return { ready: true, message: 'Ready' }; } });
  await advanceBillBatch({ ...f.item, stage: 'bill_budget' }, f.deps);
});
test('write intent precedes posting and an uncertain outcome resumes as verification', async () => {
  const f = fixture({ post: async () => { assert.deepEqual(f.calls, ['intent']); throw new Error('timeout'); } });
  const result = await advanceBillBatch({ ...f.item, stage: 'post', context: { fingerprint: ready.fingerprint } }, f.deps);
  assert.equal(result.status, 'waiting'); assert.equal(result.stage, 'verify');
  const resumed = { ...f.item, stage: 'post', writeStartedAt: new Date(), context: { hadBill: true } };
  f.deps.review = async () => ({ ...ready, action: 'current' });
  const checked = await advanceBillBatch(resumed, f.deps);
  assert.equal(checked.status, 'updated'); assert.equal(checked.clearWrite, true); assert.deepEqual(f.calls, ['intent']);
});
test('an uncertain save that is not current stays blocked without replaying it', async () => {
  const f = fixture(); const result = await advanceBillBatch({ ...f.item, stage: 'verify' }, f.deps);
  assert.equal(result.status, 'needs_attention'); assert.deepEqual(f.calls, []);
});
test('expired lease prevents a QBO write', async () => {
  const f = fixture({ markWrite: async () => { throw new Error('lease expired'); } });
  await assert.rejects(advanceBillBatch({ ...f.item, stage: 'post', context: { fingerprint: ready.fingerprint } }, f.deps), /lease expired/);
  assert.deepEqual(f.calls, []);
});
test('temporary reads back off and permanent failures become actionable', () => {
  assert.equal(batchError(new Error('host offline'), 0).status, 'waiting');
  assert.equal(batchError(new Error('host offline'), 5).status, 'needs_attention');
  assert.equal(batchError(new Error('No matching catalog item'), 0).status, 'needs_attention');
  assert.equal(batchError(new BatchWait('Quota recovery', 300000), 8).retryMs, 300000);
});

test('missing products never conceal another bill validation error', async () => {
  const f = fixture({ review: async () => ({ ...ready, products: {}, issues: ['A bill requires 1–500 cost lines.'] }) });
  const result = await advanceBillBatch(f.item, f.deps);
  assert.equal(result.status, 'needs_attention'); assert.deepEqual(f.calls, []);
  f.deps.review = async () => ({ ...ready, products: {}, issues: ['Missing QBO item mapping for Procore line 10.'] });
  assert.equal((await advanceBillBatch(f.item, f.deps)).stage, 'setup_options');
});

test('a definite stale fingerprint rejection refreshes review without replaying the old payload', async () => {
  const f = fixture({ post: async () => { throw new Error('Monthly costs or mappings changed. Reopen the project review before posting.'); } });
  const result = await advanceBillBatch({ ...f.item, stage: 'post', context: { fingerprint: ready.fingerprint } }, f.deps);
  assert.equal(result.stage, 'review'); assert.equal(result.clearWrite, true); assert.equal(result.status, 'queued');
});

test('stale existing product assignments go through setup and fresh review before a single save', async () => {
  let setup = false;
  const stages = [];
  const f = fixture({ review: async () => setup ? ready : { ...ready, canPost: false, fingerprint: null, issues: [staleMapping] },
    setup: async () => { setup = true; return { complete: true, remaining: 0 }; } });
  let item = f.item;
  let result;
  for (let i = 0; i < 12; i++) {
    stages.push(item.stage);
    result = await advanceBillBatch(item, f.deps);
    if (batchTerminal(result.status)) break;
    item = { ...item, stage: result.stage, context: result.context };
  }
  assert.equal(result.status, 'updated');
  assert.deepEqual(stages, ['review', 'setup_options', 'setup_budget', 'setup', 'review', 'bill_budget', 'prepare', 'post']);
  assert.deepEqual(f.calls, ['intent', 'post']);
});

test('a mapping changed during budget or preparation invalidates the old fingerprint', async () => {
  for (const stage of ['review', 'bill_budget', 'prepare']) {
    const f = fixture({ review: async () => ({ ...ready, issues: [staleMapping] }) });
    const result = await advanceBillBatch({ ...f.item, stage, context: { fingerprint: ready.fingerprint } }, f.deps);
    assert.equal(result.stage, 'setup_options');
    assert.equal(result.context.fingerprint, undefined);
    assert.deepEqual(f.calls, []);
  }
});

test('mapping refresh never bypasses another validation issue, reconciliation, or uncertain write', async () => {
  for (const stage of ['review', 'bill_budget', 'prepare', 'verify']) {
    for (const extra of [{ issues: [staleMapping, 'Wrong class requires review.'] }, { action: 'reconcile', issues: [staleMapping] }]) {
      const f = fixture({ review: async () => ({ ...ready, ...extra }) });
      assert.equal((await advanceBillBatch({ ...f.item, stage }, f.deps)).status, 'needs_attention');
      assert.deepEqual(f.calls, []);
    }
  }
  const f = fixture({ review: async () => ({ ...ready, issues: [staleMapping] }) });
  assert.equal((await advanceBillBatch({ ...f.item, writeStartedAt: new Date() }, f.deps)).status, 'needs_attention');
});

test('a completed setup that leaves a stale mapping blocks instead of cycling indefinitely', async () => {
  const f = fixture({ review: async () => ({ ...ready, issues: [staleMapping] }) });
  const setup = await advanceBillBatch({ ...f.item, stage: 'setup', context: { customerId: '7' } }, f.deps);
  assert.equal(setup.context.setupCompleted, true);
  const result = await advanceBillBatch({ ...f.item, context: setup.context }, f.deps);
  assert.equal(result.status, 'needs_attention');
  assert.deepEqual(result.issues, [staleMapping]);
});

test('laser screed LS mapping refresh continues through setup and one bill update', async () => {
  const issue = 'QBO product mapping for Somero S-840 (8 hr minimum) - SOG needs the .LS suffix. Run Set up products to refresh the assignment.';
  let setup = false;
  const f = fixture({ review: async () => setup ? ready : { ...ready, canPost: false, fingerprint: null, issues: [issue] },
    setup: async () => { setup = true; return { complete: true, remaining: 0 }; } });
  for (const stage of ['review', 'bill_budget', 'prepare']) {
    const step = await advanceBillBatch({ ...f.item, stage, context: { fingerprint: ready.fingerprint } }, f.deps);
    assert.equal(step.stage, 'setup_options');
    assert.equal(step.context.fingerprint, undefined);
  }
  let item = f.item, result;
  const stages = [];
  for (let i = 0; i < 12; i++) {
    stages.push(item.stage);
    result = await advanceBillBatch(item, f.deps);
    if (batchTerminal(result.status)) break;
    item = { ...item, stage: result.stage, context: result.context };
  }
  assert.equal(result.status, 'updated');
  assert.deepEqual(stages, ['review', 'setup_options', 'setup_budget', 'setup', 'review', 'bill_budget', 'prepare', 'post']);
  assert.deepEqual(f.calls, ['intent', 'post']);
  for (const extra of [{ issues: [issue, 'Wrong class requires review.'] }, { action: 'reconcile', issues: [issue] }]) {
    const blocked = fixture({ review: async () => ({ ...ready, ...extra }) });
    assert.equal((await advanceBillBatch(blocked.item, blocked.deps)).status, 'needs_attention');
    assert.deepEqual(blocked.calls, []);
  }
  const unresolved = fixture({ review: async () => ({ ...ready, issues: [issue] }) });
  assert.equal((await advanceBillBatch({ ...unresolved.item, context: { setupCompleted: true } }, unresolved.deps)).status, 'needs_attention');
});

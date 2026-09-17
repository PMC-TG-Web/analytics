import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === './qboBillComparison') return next('./qboBillComparison.ts', context);
  if (specifier === './qboBillBridge') return next('./qboBillBridge.ts', context);
  return next(specifier, context);
} });
const { loadQboBillReview } = await import('../src/lib/loadQboBillReview.ts');

test('review uses explicit project identity, reserved number, and posted or uncertain state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qbo-review-test-'));
  const previous = process.env.QBO_INTEGRATION_ROOT;
  process.env.QBO_INTEGRATION_ROOT = root;
  try {
    const directory = path.join(root, '.runtime/direct-cost-bills');
    const identity = createHash('sha256').update(JSON.stringify(['sandbox', '1', '2', '3', '2026-09'])).digest('hex');
    await mkdir(path.join(directory, 'numbers/sandbox-1/projects/2-3'), { recursive: true });
    await writeFile(path.join(directory, 'project-mapping.json'), JSON.stringify({ environment: 'sandbox', realmId: '1', companyId: '2', projectId: '3', customerName: 'Test', items: { line: { itemName: 'Product' } } }));
    await writeFile(path.join(directory, 'numbers/sandbox-1/projects/2-3/1.json'), JSON.stringify({ identity, docNumber: 'Test 001' }));
    const initial = await loadQboBillReview('2', '3', '2026-09');
    assert.equal(initial.action, 'create'); assert.equal(initial.billNumber, 'Test 001'); assert.equal(initial.products.line, 'Product');
    assert.equal((await loadQboBillReview('2', '99', '2026-09')).connected, false);
    const claim = path.join(directory, 'posted', identity);
    await mkdir(claim, { recursive: true });
    assert.equal((await loadQboBillReview('2', '3', '2026-09')).action, 'reconcile');
    await writeFile(path.join(claim, 'receipt.json'), JSON.stringify({ billId: '10', docNumber: 'PMCDC001', postedAt: '2026-09-16' }));
    assert.equal((await loadQboBillReview('2', '3', '2026-09')).action, 'update');
    const emptyDraft = { month: '2026-09', issues: [], lines: [] };
    assert.equal((await loadQboBillReview('2', '3', '2026-09', emptyDraft)).action, 'reconcile', 'missing successful request cannot be labeled up to date');
    const requestId = `pc-${'a'.repeat(40)}`;
    await writeFile(path.join(claim, 'receipt.json'), JSON.stringify({ billId: '10', docNumber: 'PMCDC001', requestId, fingerprint: 'one' }));
    await writeFile(path.join(claim, 'attempt.json'), JSON.stringify({ requestId, fingerprint: 'one', payload: { VendorRef: { value: '' }, Line: [] } }));
    assert.equal((await loadQboBillReview('2', '3', '2026-09', emptyDraft)).action, 'current');
    const nextRequest = `pc-${'b'.repeat(40)}`;
    await writeFile(path.join(claim, 'receipt.json'), JSON.stringify({ billId: '10', requestId: nextRequest, fingerprint: 'two' }));
    await writeFile(path.join(claim, `update-${nextRequest}.json`), JSON.stringify({ prepared: { fingerprint: 'two', payload: { VendorRef: { value: 'changed' }, Line: [] } } }));
    assert.equal((await loadQboBillReview('2', '3', '2026-09', emptyDraft)).action, 'update', 'compare last successful update instead of initial creation');
    await writeFile(path.join(claim, 'update-pending.json'), '{}');
    assert.equal((await loadQboBillReview('2', '3', '2026-09')).action, 'reconcile');
  } finally {
    if (previous === undefined) delete process.env.QBO_INTEGRATION_ROOT; else process.env.QBO_INTEGRATION_ROOT = previous;
    assert.match(path.relative(path.resolve(os.tmpdir()), path.resolve(root)), /^qbo-review-test-[^\\/]+$/);
    await rm(root, { recursive: true, force: true });
  }
});

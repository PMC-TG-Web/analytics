import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { validateCsrfRequest } from '../src/lib/csrfProtection.ts';
function route({ actor = 'operator@example.test', enabled = true } = {}) {
  const calls = [];
  const imports = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/requestUser': { getRequestUserEmail: async () => actor },
    '@/lib/csrfProtection': { validateCsrfRequest },
    '@/lib/qboBillBatchStore': { billBatchEnabled: () => enabled, startBillBatch: async (...args) => { calls.push(args); return { id: 'run1', month: '2026-09' }; }, getBillBatch: async () => null },
    '@/lib/qboBillBatchDispatch': { dispatchBillBatch: async () => false },
  };
  const js = ts.transpileModule(fs.readFileSync('src/app/api/accounting/direct-cost-bills/batch/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} }; vm.runInNewContext(js, { exports: m.exports, require: id => imports[id] });
  return { ...m.exports, calls };
}
const request = (origin = 'https://example.test') => new Request('https://example.test/api/accounting/direct-cost-bills/batch', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ companyId: '1', month: '2026-09', requestKey: 'a'.repeat(36), projectIds: ['10'], actor: 'forged' }) });
test('start requires session, CSRF and explicit feature enablement', async () => {
  for (const [opts, origin, expected] of [[{ actor: null }, 'https://example.test', 401], [{}, 'https://other.test', 403], [{ enabled: false }, 'https://example.test', 503]]) {
    const h = route(opts); assert.equal((await h.POST(request(origin))).status, expected); assert.equal(h.calls.length, 0);
  }
});
test('accepted run uses session identity and survives a failed worker dispatch', async () => {
  const h = route(); const response = await h.POST(request()); const body = await response.json();
  assert.equal(response.status, 202); assert.equal(body.runId, 'run1'); assert.equal(body.dispatched, false);
  assert.equal(h.calls[0][2], 'operator@example.test'); assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.deepEqual(Array.from(h.calls[0][5]), ['10']);
});
test('worker rejects missing and incorrect secrets even when disabled', async () => {
  const prior = process.env.PROCORE_SYNC_SECRET;
  process.env.PROCORE_SYNC_SECRET = 'unit-test-secret';
  try {
    const { default: handler } = await import('../netlify/functions/qbo-bill-batch-background.mts');
    for (const headers of [{}, { 'x-sync-secret': 'bad' }]) assert.equal((await handler(new Request('https://example.test', { headers }))).status, 401);
  } finally { if (prior === undefined) delete process.env.PROCORE_SYNC_SECRET; else process.env.PROCORE_SYNC_SECRET = prior; }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { validateCsrfRequest } from '../src/lib/csrfProtection.ts';

const js = ts.transpileModule(fs.readFileSync('src/app/api/accounting/direct-cost-bills/reconcile/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function route(actor = 'operator@example.test') {
  const writes = [];
  const imports = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/requestUser': { getRequestUserEmail: async () => actor },
    '@/lib/csrfProtection': { validateCsrfRequest },
    '@/lib/loadQboDirectCosts': { loadQboDirectCosts: async () => ({ trusted: true }) },
    '@/lib/qboBillBridge': { requestQboBillBridge: async body => { writes.push({ body, operator: body.actor }); return { saved: true }; } },
  };
  const module = { exports: {} };
  vm.runInNewContext(js, { exports: module.exports, process: { env: { PROCORE_COMPANY_ID: '1' } }, require: id => imports[id] });
  return { ...module.exports, writes };
}
const body = () => ({ companyId: '1', projectId: '2', month: '2026-09', operation: 'confirm', fingerprint: 'a'.repeat(64) });
const request = (data = body(), origin = 'https://example.test') => new Request('https://example.test/api/accounting/direct-cost-bills/reconcile', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
test('reconciliation writes require a signed-in operator and same-origin request', async () => {
  const h = route(null); assert.equal((await h.POST(request())).status, 401); assert.equal(h.writes.length, 0);
  const signedIn = route(); assert.equal((await signedIn.POST(request(body(), 'https://other.test'))).status, 403); assert.equal(signedIn.writes.length, 0);
});
test('reconciliation endpoint rejects cross-company and malformed identities', async () => {
  const h = route();
  for (const change of [{ companyId: '9' }, { projectId: 'bad' }, { operation: 'post' }, { month: '2026-13' }, { fingerprint: 'stale' }]) assert.equal((await h.POST(request({ ...body(), ...change }))).status, 400);
  assert.equal(h.writes.length, 0);
});
test('valid save uses session attribution and private no-store responses', async () => {
  const h = route(); const response = await h.POST(request());
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private, no-store/);
  assert.equal(h.writes[0].operator, 'operator@example.test');
  assert.equal(h.writes[0].body.operation, 'reconcile-confirm');
  assert.equal(h.writes[0].body.draft.trusted, true);
});

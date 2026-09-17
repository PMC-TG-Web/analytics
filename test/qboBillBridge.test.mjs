import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { requestQboBillBridge } from '../src/lib/qboBillBridge.ts';

test('shared bridge requires HTTPS, keeps credentials on the server, and refuses redirects', async () => {
  const previous = { url: process.env.QBO_BILL_BRIDGE_URL, secret: process.env.QBO_BILL_BRIDGE_SECRET, fetch: globalThis.fetch };
  try {
    process.env.QBO_BILL_BRIDGE_SECRET = 'x'.repeat(32);
    process.env.QBO_BILL_BRIDGE_URL = 'http://remote.example/direct-cost-bills';
    await assert.rejects(requestQboBillBridge({}), /secure/);
    process.env.QBO_BILL_BRIDGE_URL = 'https://bridge.example/direct-cost-bills';
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), process.env.QBO_BILL_BRIDGE_URL);
      assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, `Bearer ${'x'.repeat(32)}`);
      return new Response(JSON.stringify({ billNumber: 'PMCDC001' }));
    };
    assert.equal((await requestQboBillBridge({ operation: 'prepare' })).billNumber, 'PMCDC001');
    globalThis.fetch = async () => { throw new Error('network'); };
    await assert.rejects(requestQboBillBridge({}), /check its saved status/);
  } finally {
    for (const [name, value] of [['QBO_BILL_BRIDGE_URL', previous.url], ['QBO_BILL_BRIDGE_SECRET', previous.secret]]) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    globalThis.fetch = previous.fetch;
  }
});

test('browser write route keeps authentication, CSRF, and server-side source rebuilding', async () => {
  const route = await readFile(new URL('../src/app/api/accounting/direct-cost-bills/route.ts', import.meta.url), 'utf8');
  assert.match(route, /validateCsrfRequest/); assert.match(route, /getRequestUserEmail\(request\)/);
  assert.match(route, /loadQboDirectCosts\(body.companyId, body.projectId, body.month\)/);
  assert.match(route, /fingerprint: body.fingerprint, draft, actor/);
});

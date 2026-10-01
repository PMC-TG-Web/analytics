import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function route() {
  const calls = [];
  const imports = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/loadQboBillQueue': { loadQboBillQueue: async (...args) => {
      calls.push(args);
      return { rows: [{ projectId: '10' }], nextCursor: '10', totalProjects: 5 };
    } },
  };
  const js = ts.transpileModule(fs.readFileSync('src/app/api/accounting/direct-cost-bills/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const m = { exports: {} };
  vm.runInNewContext(js, { exports: m.exports, require: id => imports[id] || {}, console: { info() {}, error() {} } });
  return { ...m.exports, calls };
}
const request = query => ({ nextUrl: new URL(`https://example.test/api/accounting/direct-cost-bills?companyId=1&month=2026-09&view=queue${query}`) });

test('old open pages receive a reload instruction without starting unbounded work', async () => {
  for (const query of ['', '&paged=0']) {
    const h = route();
    const response = await h.GET(request(query));
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.code, 'BILL_PAGE_RELOAD_REQUIRED');
    assert.match(body.error, /new browser tab/);
    assert.match(response.headers.get('cache-control'), /private, no-store/);
    assert.equal(h.calls.length, 0);
    assert.equal(body.rows, undefined);
  }
});

test('updated pages keep their bounded cursor and complete pagination response', async () => {
  const h = route();
  const response = await h.GET(request('&paged=1&after=9'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { rows: [{ projectId: '10' }], nextCursor: '10', totalProjects: 5 });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], '1');
  assert.equal(h.calls[0][1], '2026-09');
  assert.equal(h.calls[0][2].after, '9');
});

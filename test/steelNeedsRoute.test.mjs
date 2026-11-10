import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { validateCsrfRequest } from '../src/lib/csrfProtection.ts';
import { parseSteelOrderInput, SteelOrderConflict } from '../src/lib/steelOrderMarks.ts';

const compiled = ts.transpileModule(readFileSync('src/app/api/steel-needs/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function setup({ actor = 'user@example.com', allowed = true, fail = false, projects = [], conflict = false } = {}) {
  let reads = 0, writes = 0;
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/prisma': { prisma: {} },
    '@/lib/requestUser': { getRequestUserEmail: async () => actor },
    '@/lib/permissions': { hasDatabasePageAccess: async (_db, email, page) => { assert.equal(email, actor); assert.equal(page, 'page:/steel-needs'); return allowed; } },
    '@/lib/loadSteelNeeds': { loadSteelNeeds: async () => { reads++; if (fail) throw Error('private database details'); return { projects, loadedAt: 'now', localOnly: false }; } },
    '@/lib/loadWipPlanning': { wipCompanyId: () => 'company' },
    '@/lib/csrfProtection': { validateCsrfRequest },
    '@/lib/steelOrderMarks': { parseSteelOrderInput, SteelOrderConflict, saveSteelOrderMark: async (_db, company, email, input) => {
      assert.equal(company, 'company'); assert.equal(email, actor); writes++;
      if (conflict) throw new SteelOrderConflict('Refresh saved data.');
      return { revision: input.revision + 1, orderedAt: input.ordered ? '2026-11-10T12:00:00Z' : null, quantity: input.ordered ? input.quantity : null };
    } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => { assert.ok(id in mocks); return mocks[id]; }, module, module.exports);
  return { ...module.exports, reads: () => reads, writes: () => writes };
}
test('Steel needs denies unauthenticated and unauthorized requests before any source reads', async () => {
  for (const [options, status] of [[{ actor: null }, 401], [{ allowed: false }, 403]]) {
    const fixture = setup(options), response = await fixture.GET({});
    assert.equal(response.status, status); assert.equal(fixture.reads(), 0); assert.match(response.headers.get('Cache-Control'), /private, no-store/);
  }
});

const input = { projectId: '101', itemKey: 'material', quantity: 100, revision: 0, ordered: true };
const request = (body = input, origin = 'https://example.com') => new Request('https://example.com/api/steel-needs', {
  method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
test('order checkboxes require authentication, independent page access and same-origin CSRF', async () => {
  for (const [options, origin, status] of [[{ actor: null }, 'https://example.com', 401], [{ allowed: false }, 'https://example.com', 403], [{}, 'https://other.example', 403]]) {
    const fixture = setup(options);
    assert.equal((await fixture.POST(request(input, origin))).status, status);
    assert.equal(fixture.reads(), 0); assert.equal(fixture.writes(), 0);
  }
});
test('invalid, stale and unknown project/material requests cannot save checkmarks', async () => {
  for (const body of ['bad json', { ...input, ordered: 'yes' }, { ...input, quantity: -2 }, { ...input, revision: -1 }, { ...input, projectId: 'p1' }]) {
    const fixture = setup(); assert.equal((await fixture.POST(request(body))).status, 400); assert.equal(fixture.writes(), 0);
  }
  for (const projects of [[], [{ projectId: '102', items: [{ key: 'material', quantity: 100 }] }], [{ projectId: '101', items: [{ key: 'material', quantity: 101 }] }]]) {
    const fixture = setup({ projects }); assert.equal((await fixture.POST(request())).status, 409); assert.equal(fixture.writes(), 0);
  }
});
test('valid project/material toggles return the server stamp and conflicts require refresh', async () => {
  const projects = [{ projectId: '101', items: [{ key: 'material', quantity: 100 }] }];
  const fixture = setup({ projects });
  const response = await fixture.POST(request({ ...input, companyId: 'untrusted', orderedAt: '2001-01-01' }));
  assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.equal((await response.json()).order.orderedAt, '2026-11-10T12:00:00Z');
  assert.equal(fixture.writes(), 1);
  assert.equal((await setup({ projects, conflict: true }).POST(request())).status, 409);
  assert.equal((await setup({ fail: true }).POST(request())).status, 503);
});
test('Steel needs returns no-store complete reads and reports errors without exposing database details', async () => {
  const response = await setup().GET({}); assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.deepEqual((await response.json()).projects, []);
  const failed = await setup({ fail: true }).GET({}); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /private database/);
});

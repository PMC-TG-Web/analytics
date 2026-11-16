import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { validateCsrfRequest } from '../src/lib/csrfProtection.ts';
import { parseSteelOrderInput, SteelOrderConflict } from '../src/lib/steelOrderMarks.ts';
import { createSteelOrderSnapshot, verifySteelOrderSnapshot } from '../src/lib/steelOrderSnapshot.ts';

const secret = 'fixture-only-signing-key';

const compiled = ts.transpileModule(readFileSync('src/app/api/steel-needs/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function setup({ actor = 'user@example.com', allowed = true, fail = false, projects = [], conflict = false } = {}) {
  let reads = 0, writes = 0, lastInput = null;
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/prisma': { prisma: {} },
    '@/lib/requestUser': { getRequestUserEmail: async () => actor },
    '@/lib/permissions': { hasDatabasePageAccess: async (_db, email, page) => { assert.equal(email, actor); assert.equal(page, 'page:/steel-needs'); return allowed; } },
    '@/lib/loadSteelNeeds': { loadSteelNeeds: async () => { reads++; if (fail) throw Error('private database details'); return { projects, loadedAt: 'now', localOnly: false }; } },
    '@/lib/loadWipPlanning': { wipCompanyId: () => 'company' },
    '@/lib/csrfProtection': { validateCsrfRequest },
    '@/lib/steelOrderSnapshot': {
      createSteelOrderSnapshot: (company, input) => createSteelOrderSnapshot(company, input, secret),
      verifySteelOrderSnapshot: (token, company, input) => verifySteelOrderSnapshot(token, company, input, secret),
    },
    '@/lib/steelOrderMarks': { parseSteelOrderInput, SteelOrderConflict, saveSteelOrder: async (_db, company, email, input) => {
      assert.equal(company, 'company'); assert.equal(email, actor); writes++; lastInput = input;
      if (conflict) throw new SteelOrderConflict('Refresh saved data.');
      if (fail) throw Error('private database details');
      return { order: { revision: input.revision + 1, orderedAt: input.ordered ? '2026-11-10T12:00:00Z' : null, quantity: input.ordered ? input.orderedQuantity ?? input.quantity : null, estimateQuantity: input.ordered ? input.quantity : null }, log: [] };
    } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => { assert.ok(id in mocks); return mocks[id]; }, module, module.exports);
  return { ...module.exports, reads: () => reads, writes: () => writes, lastInput: () => lastInput };
}
test('Steel needs denies unauthenticated and unauthorized requests before any source reads', async () => {
  for (const [options, status] of [[{ actor: null }, 401], [{ allowed: false }, 403]]) {
    const fixture = setup(options), response = await fixture.GET({});
    assert.equal(response.status, status); assert.equal(fixture.reads(), 0); assert.match(response.headers.get('Cache-Control'), /private, no-store/);
  }
});

const input = { projectId: '101', itemKey: 'material', quantity: 100, revision: 0, ordered: true };
input.orderSnapshot = createSteelOrderSnapshot('company', input, secret);
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
test('invalid and unsigned project/material requests cannot save checkmarks', async () => {
  for (const body of ['bad json', { ...input, ordered: 'yes' }, { ...input, quantity: -2 }, { ...input, revision: -1 }, { ...input, projectId: 'p1' }]) {
    const fixture = setup(); assert.equal((await fixture.POST(request(body))).status, 400); assert.equal(fixture.writes(), 0);
  }
  for (const body of [{ ...input, orderSnapshot: undefined }, { ...input, projectId: '102' }, { ...input, itemKey: 'unknown' }, { ...input, quantity: 101 }, { ...input, orderSnapshot: createSteelOrderSnapshot('other-company', input, secret) }]) {
    const fixture = setup(); assert.equal((await fixture.POST(request(body))).status, 409); assert.equal(fixture.writes(), 0); assert.equal(fixture.reads(), 0);
  }
});
test('valid snapshots save without rebuilding the report; server stamps and revision conflicts remain enforced', async () => {
  const projects = [{ projectId: '101', items: [{ key: 'material', quantity: 100 }] }];
  const fixture = setup({ projects });
  const response = await fixture.POST(request({ ...input, companyId: 'untrusted', orderedAt: '2001-01-01' }));
  assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.equal((await response.json()).order.orderedAt, '2026-11-10T12:00:00Z');
  assert.equal(fixture.writes(), 1);
  assert.equal(fixture.reads(), 0);
  assert.equal((await setup({ projects, conflict: true }).POST(request())).status, 409);
  assert.equal((await setup({ fail: true }).POST(request())).status, 503);
});

test('GET signs only linked material snapshots that POST accepts without source reads', async () => {
  const fixture = setup({ projects: [{ projectId: '101', items: [{ key: 'material', quantity: 100 }] }, { projectId: null, items: [{ key: 'unlinked', quantity: 10 }] }] });
  const report = await (await fixture.GET({})).json();
  const token = report.projects[0].items[0].orderSnapshot;
  assert.equal(verifySteelOrderSnapshot(token, 'company', input, secret), true);
  assert.equal(report.projects[1].items[0].orderSnapshot, undefined);
  assert.equal((await fixture.POST(request({ ...input, orderSnapshot: token }))).status, 200);
  assert.equal(fixture.reads(), 1);
});

test('partial order saves validate the signed estimate, not the entered piece count, without loading the report', async () => {
  const partial = { ...input, itemKey: '["rebar","EA"]', quantity: 450, orderedQuantity: 150 };
  partial.orderSnapshot = createSteelOrderSnapshot('company', partial, secret);
  const fixture = setup();
  const response = await fixture.POST(request(partial));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { order: { revision: 1, orderedAt: '2026-11-10T12:00:00Z', quantity: 150, estimateQuantity: 450 }, log: [] });
  assert.equal(fixture.reads(), 0);
  assert.equal((await fixture.POST(request({ ...partial, quantity: 600 }))).status, 409);
  assert.equal((await fixture.POST(request({ ...partial, orderedQuantity: 1.5 }))).status, 400);
  assert.equal((await fixture.POST(request({ ...partial, orderedQuantity: 0, ordered: false }))).status, 200);
});
test('adding and undoing orders require the signed estimate snapshot and pass exactly one change to the save', async () => {
  const add = { projectId: '101', itemKey: '["rebar","EA"]', quantity: 450, revision: 2, addQuantity: 150 };
  add.orderSnapshot = createSteelOrderSnapshot('company', add, secret);
  const fixture = setup();
  const response = await fixture.POST(request(add));
  assert.equal(response.status, 200); assert.deepEqual((await response.json()).log, []);
  assert.deepEqual(fixture.lastInput(), { projectId: '101', itemKey: '["rebar","EA"]', revision: 2, quantity: 450, ordered: true, addQuantity: 150 });
  const undo = { ...add, addQuantity: undefined, undoEntryId: '00000000-0000-4000-8000-000000000001' };
  assert.equal((await fixture.POST(request(undo))).status, 200);
  assert.equal(fixture.lastInput().undoEntryId, undo.undoEntryId); assert.equal(fixture.lastInput().addQuantity, undefined);
  assert.equal(fixture.writes(), 2); assert.equal(fixture.reads(), 0);
  for (const body of [{ ...add, addQuantity: 0 }, { ...add, addQuantity: 1.5 }, { ...add, orderedQuantity: 150, ordered: true }, { ...undo, undoEntryId: 'x' }]) {
    assert.equal((await fixture.POST(request(body))).status, 400);
  }
  for (const body of [{ ...add, quantity: 451 }, { ...add, orderSnapshot: undefined }, { ...undo, projectId: '102' }]) {
    assert.equal((await fixture.POST(request(body))).status, 409);
  }
  assert.equal(fixture.writes(), 2, 'refused requests never reach the save');
});
test('Steel needs returns no-store complete reads and reports errors without exposing database details', async () => {
  const response = await setup().GET({}); assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.deepEqual((await response.json()).projects, []);
  const failed = await setup({ fail: true }).GET({}); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /private database/);
});

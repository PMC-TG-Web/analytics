import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { validateWipAllocations } from '../src/lib/wipPlanning.ts';
import { validateCsrfRequest } from '../src/lib/csrfProtection.ts';
import { resolvePermissionForPath } from '../src/lib/permissionRoutes.js';

const compiled = ts.transpileModule(readFileSync('src/app/api/wip/route.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const source = { bidBoardId: '11', proposalId: '22', estimatedHours: 1200, projectManagementHours: 200, allocatableHours: 1000 };
const input = { projectId: '101', revision: 0, fingerprint: 'current', allocations: [{ month: '2026-10', percent: 100 }], notes: 'Expected work' };
function setup({ actor = 'pm@example.com', permission = true, projects = [{ projectId: '101', fingerprint: 'current', source, issue: null }], revision = 0, fail = false } = {}) {
  const calls = [];
  let saved = revision ? { ...input, companyId: 'company', revision, source } : null;
  const revisions = [];
  class KnownError extends Error { constructor(code) { super('sensitive database details'); this.code = code; } }
  const tx = {
    wipPlan: {
      create: async ({ data }) => { if (saved) throw new KnownError('P2002'); saved = { ...data, updatedAt: new Date() }; },
      updateMany: async ({ where, data }) => { if (saved?.revision !== where.revision) return { count: 0 }; saved = { ...saved, ...data, updatedAt: new Date() }; return { count: 1 }; },
      findUniqueOrThrow: async () => saved,
    },
    wipPlanRevision: { create: async ({ data }) => { revisions.push(data); } },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@prisma/client': { Prisma: { PrismaClientKnownRequestError: KnownError } },
    '@/lib/prisma': { prisma: {
      $transaction: async fn => { calls.push('transaction'); return fn(tx); },
      wipPlanRevision: { findMany: async query => { calls.push(query); return []; } },
    } },
    '@/lib/requestUser': { getRequestUserEmail: async () => actor },
    '@/lib/permissions': { hasDatabasePageAccess: async (_db, email, page) => { assert.equal(email, actor); assert.equal(page, 'wip'); return permission; } },
    '@/lib/csrfProtection': { validateCsrfRequest },
    '@/lib/loadWipPlanning': { wipCompanyId: () => 'company', loadWipPlanning: async force => { calls.push({ force }); if (fail) throw new Error('sensitive database details'); return projects; } },
    '@/lib/wipPlanning': { validateWipAllocations },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => { assert.ok(id in mocks, id); return mocks[id]; }, module, module.exports);
  return { ...module.exports, calls, revisions, get saved() { return saved; } };
}
function request(body, origin = 'https://example.com') {
  const req = new Request('https://example.com/api/wip', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return req;
}
const getRequest = (query = '') => ({ nextUrl: new URL(`https://example.com/api/wip${query}`) });

test('WIP page, help and API share a dedicated permission', () => {
  for (const path of ['/wip', '/api/wip', '/help/wip']) assert.equal(resolvePermissionForPath(path), 'wip');
  assert.equal(resolvePermissionForPath('/api/wip-unrelated'), null);
});
test('anonymous, forbidden and cross-origin requests cannot read or write plans', async () => {
  for (const [options, expected] of [[{ actor: null }, 401], [{ permission: false }, 403]]) {
    const fixture = setup(options);
    assert.equal((await fixture.GET(getRequest())).status, expected);
    assert.equal((await fixture.POST(request(input))).status, expected);
    assert.equal(fixture.calls.length, 0);
  }
  const fixture = setup();
  assert.equal((await fixture.POST(request(input, 'https://other.example'))).status, 403);
  assert.equal(fixture.calls.length, 0);
});
test('valid plan saves canonical source and immutable revision in one transaction', async () => {
  const fixture = setup();
  const response = await fixture.POST(request({ ...input, companyId: 'attacker', source: { allocatableHours: 99999 } }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.equal(fixture.saved.companyId, 'company');
  assert.deepEqual(fixture.saved.source, source);
  assert.equal(fixture.saved.updatedBy, 'pm@example.com');
  assert.equal(fixture.revisions.length, 1);
  assert.equal(fixture.revisions[0].revision, 1);
  assert.deepEqual(fixture.calls, [{ force: true }, 'transaction']);
});
test('invalid totals, stale estimates and non-In Progress projects never write', async () => {
  for (const [options, body, expected] of [
    [{}, { ...input, allocations: [{ month: '2026-10', percent: 40 }] }, 400],
    [{}, { ...input, fingerprint: 'old' }, 409],
    [{ projects: [] }, input, 409],
    [{ projects: [{ projectId: '101', fingerprint: 'current', issue: 'Missing estimate' }] }, input, 409],
  ]) {
    const fixture = setup(options);
    assert.equal((await fixture.POST(request(body))).status, expected);
    assert.ok(!fixture.calls.includes('transaction'));
  }
});
test('both first-save collisions and stale updates preserve the current plan', async () => {
  for (const expectedRevision of [0, 1]) {
    const fixture = setup({ revision: 2 });
    assert.equal((await fixture.POST(request({ ...input, revision: expectedRevision }))).status, 409);
    assert.equal(fixture.saved.revision, 2);
    assert.equal(fixture.revisions.length, 0);
  }
  const fixture = setup({ revision: 2 });
  assert.equal((await fixture.POST(request({ ...input, revision: 2 }))).status, 200);
  assert.equal(fixture.saved.revision, 3);
  assert.equal(fixture.revisions[0].revision, 3);
});
test('history stays company-scoped and errors do not expose database details', async () => {
  const fixture = setup();
  assert.equal((await fixture.GET(getRequest('?projectId=101'))).status, 200);
  assert.deepEqual(fixture.calls[0].where, { companyId: 'company', projectId: '101' });
  assert.equal(fixture.calls[0].take, 50);
  const response = await setup({ fail: true }).GET(getRequest());
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /sensitive database details/);
});
test('legacy page URLs retire into WIP without removing shared scheduling data', () => {
  const config = readFileSync('next.config.ts', 'utf8');
  const nav = readFileSync('src/components/Navigation.tsx', 'utf8');
  for (const path of ['/scheduling', '/project-schedule', '/long-term-schedule', '/short-term-schedule', '/concrete-orders-schedule', '/daily-crew-dispatch-board']) {
    assert.ok(config.includes(`'${path}'`));
    assert.ok(!nav.includes(`href: "${path}"`));
  }
  const migration = readFileSync('prisma/migrations/20261012190000_wip_estimate_plans/migration.sql', 'utf8');
  assert.doesNotMatch(migration, /DROP|TRUNCATE|DELETE FROM/);
});

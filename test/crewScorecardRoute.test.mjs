import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { isLocalDeveloperRequest } from '../src/lib/developerIdentity.ts';
import { crewWeekRange } from '../src/lib/crewScorecard.ts';
import { resolvePermissionForPath } from '../src/lib/permissionRoutes.js';

const compiled = ts.transpileModule(readFileSync(new URL('../src/app/api/crew-scorecard/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup({ environment = 'development', actor = 'operator@example.test', permission = true, company = 'configured-company', fail = false, authFail = false } = {}) {
  const calls = [];
  const logs = [];
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/developerIdentity': { isLocalDeveloperRequest: request => isLocalDeveloperRequest(request, environment) },
    '@/lib/requestUser': { getRequestUserEmail: async () => { calls.push('identity'); if (authFail) throw new Error('private connection details'); return actor; } },
    '@/lib/permissions': { hasDatabasePageAccess: async (_prisma, email, page) => { assert.equal(email, actor); assert.equal(page, 'analytics'); return permission; } },
    '@/lib/prisma': { prisma: {} },
    '@/lib/crewScorecard': { crewWeekRange },
    '@/lib/loadCrewScorecard': { loadCrewScorecard: async (companyId, week) => {
      calls.push({ companyId, week });
      if (fail) throw new Error('private database URL and credentials');
      return { companyId, week, crews: [] };
    } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', 'console', compiled)(
    id => { assert.ok(id in mocks, id); return mocks[id]; }, module, module.exports,
    { env: { PROCORE_COMPANY_ID: company } }, { error: (...args) => logs.push(args) },
  );
  return { ...module.exports, calls, logs };
}
const request = (url = 'http://localhost:3000/api/crew-scorecard?week=2026-10-19') => ({ nextUrl: new URL(url) });

test('page, API and help require Analytics, without widening adjacent paths', () => {
  for (const path of ['/crew-scorecard', '/api/crew-scorecard', '/help/crew-scorecard']) assert.equal(resolvePermissionForPath(path), 'analytics');
  for (const path of ['/crew-scorecard-other', '/api/crew-scorecard-other', '/help/crew-scorecard-other']) assert.equal(resolvePermissionForPath(path), null);
});

test('preview never reads data in production, test mode or on non-loopback hosts', async () => {
  for (const environment of ['production', 'test']) {
    const route = setup({ environment });
    assert.equal((await route.GET(request())).status, 404);
    assert.deepEqual(route.calls, []);
  }
  for (const host of ['app.example.test', 'localhost.example.test', '192.168.1.5']) {
    const route = setup();
    assert.equal((await route.GET(request(`http://${host}/api/crew-scorecard?week=2026-10-19`))).status, 404);
    assert.deepEqual(route.calls, []);
  }
  for (const host of ['localhost', '127.0.0.1', '[::1]']) assert.equal((await setup().GET(request(`http://${host}/api/crew-scorecard?week=2026-10-19`))).status, 200);
});

test('local preview still requires both authentication and database Analytics permission', async () => {
  for (const [options, status] of [[{ actor: null }, 401], [{ permission: false }, 403]]) {
    const route = setup(options);
    const response = await route.GET(request());
    assert.equal(response.status, status);
    assert.match(response.headers.get('Cache-Control'), /private, no-store/);
    assert.deepEqual(route.calls, ['identity']);
  }
});

test('read-only API uses the configured company rather than user-supplied identity and never caches', async () => {
  const route = setup();
  const response = await route.GET(request('http://localhost:3000/api/crew-scorecard?week=2026-10-19&companyId=other'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).companyId, 'configured-company');
  assert.match(response.headers.get('Cache-Control'), /private, no-store/);
  assert.deepEqual(route.calls[1], { companyId: 'configured-company', week: '2026-10-19' });
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) assert.equal(route[method], undefined);
});

test('invalid dates and missing configuration cannot start a report read', async () => {
  for (const week of ['', '2026-10-20', '2026-02-30', 'bad']) {
    const route = setup();
    const response = await route.GET(request(`http://localhost:3000/api/crew-scorecard?week=${week}`));
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error);
    assert.deepEqual(route.calls, ['identity']);
  }
  const route = setup({ company: '' });
  assert.equal((await route.GET(request())).status, 503);
  assert.deepEqual(route.calls, ['identity']);
});

test('read and authentication errors are logged without secrets and never returned as empty success', async () => {
  for (const options of [{ fail: true }, { authFail: true }]) {
    const route = setup(options);
    const response = await route.GET(request());
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, /No partial totals/);
    assert.doesNotMatch(body, /private database|credentials|connection details/);
    assert.equal(route.logs.length, 1);
    assert.doesNotMatch(JSON.stringify(route.logs), /credentials|connection details/);
  }
});

test('server page enforces the same local and permission gates and navigation is local-only', () => {
  const page = readFileSync(new URL('../src/app/crew-scorecard/page.tsx', import.meta.url), 'utf8');
  const nav = readFileSync(new URL('../src/components/Navigation.tsx', import.meta.url), 'utf8');
  assert.match(page, /isLocalDeveloperRequest\(localRequest\)\) notFound/);
  assert.match(page, /hasDatabasePageAccess\(prisma, email, 'analytics'\)/);
  assert.match(nav, /href: "\/crew-scorecard".*localOnly: true/);
  assert.match(nav, /!link\.localOnly \|\| localPreview/);
});

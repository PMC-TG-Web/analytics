import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { usagePeriod } from '../src/lib/projectUsageReport.ts';
import { resolvePermissionForPath } from '../src/lib/permissionRoutes.js';

const compiled = ts.transpileModule(readFileSync(new URL('../src/app/api/reporting/project-usage/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function setup({ actor = 'user@example.test', allowed = true, company = 'configured', fail = false } = {}) {
  const calls = []; const logs = [];
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/requestUser': { getRequestUserEmail: async () => actor },
    '@/lib/permissions': { hasDatabasePageAccess: async (_db, email, permission) => { assert.equal(email, actor); assert.equal(permission, 'reporting'); return allowed; } },
    '@/lib/prisma': { prisma: {} }, '@/lib/projectUsageReport': { usagePeriod },
    '@/lib/loadProjectUsageReport': { loadProjectUsageReport: async (...args) => { calls.push(args); if (fail) throw new Error('private credentials'); return { projects: [] }; } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', 'console', compiled)(id => { assert.ok(id in mocks, id); return mocks[id]; },
    module, module.exports, { env: { PROCORE_COMPANY_ID: company } }, { error: (...args) => logs.push(args) });
  return { ...module.exports, calls, logs };
}
const req = (query = '') => ({ nextUrl: new URL(`https://example.test/api/reporting/project-usage${query}`) });

test('Reporting page, help and API have matching permission boundaries', () => {
  for (const path of ['/reporting', '/help/reporting', '/api/reporting/project-usage']) assert.equal(resolvePermissionForPath(path), 'reporting');
  assert.equal(resolvePermissionForPath('/api/reporting-other'), null);
});
test('report data requires authenticated database Reporting access', async () => {
  for (const [options, status] of [[{ actor: null }, 401], [{ allowed: false }, 403]]) {
    const route = setup(options); const response = await route.GET(req());
    assert.equal(response.status, status); assert.deepEqual(route.calls, []);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
});
test('configured company and validated period are passed to the read-only loader', async () => {
  const route = setup(); const response = await route.GET(req('?from=2026-10-01&through=2026-10-22&companyId=attacker'));
  assert.equal(response.status, 200); assert.deepEqual(route.calls, [['configured', '2026-10-01', '2026-10-22']]);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(route[method], undefined);
});
test('invalid dates, missing configuration and failed reads never return partial success', async () => {
  for (const query of ['?from=2026-02-30', '?from=2026-10-22&through=2026-10-01']) {
    const route = setup(); assert.equal((await route.GET(req(query))).status, 400); assert.deepEqual(route.calls, []);
  }
  const missing = setup({ company: '' }); assert.equal((await missing.GET(req())).status, 503); assert.deepEqual(missing.calls, []);
  const route = setup({ fail: true }); const response = await route.GET(req());
  assert.equal(response.status, 503); assert.match((await response.json()).error, /No partial totals/);
  assert.doesNotMatch(JSON.stringify(route.logs), /credentials/);
});

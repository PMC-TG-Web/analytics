import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { usagePeriod } from '../src/lib/projectUsageReport.ts';
import { apiPagePermissions } from '../src/lib/independentPagePermissions.js';
import { expandAssignedPermissions } from '../src/lib/permissions.ts';
import { PAGE_ACCESS_CATALOG } from '../src/lib/pageAccessCatalog.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../src/app/api/reporting/hours/route.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function setup({ actor = 'user@example.test', allowed = true, company = 'configured', fail = false } = {}) {
  const calls = []; const logs = [];
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/requestUser': { getRequestUserEmail: async () => actor },
    '@/lib/permissions': { hasDatabasePageAccess: async (_db, email, permission) => { assert.equal(email, actor); assert.equal(permission, 'page:/reporting/hours'); return allowed; } },
    '@/lib/prisma': { prisma: {} }, '@/lib/projectUsageReport': { usagePeriod },
    '@/lib/loadHoursReport': { loadHoursReport: async (...args) => { calls.push(args); if (fail) throw new Error('private credentials'); return { entries: [] }; } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'process', 'console', compiled)(id => { assert.ok(id in mocks, id); return mocks[id]; },
    module, module.exports, { env: { PROCORE_COMPANY_ID: company } }, { error: (...args) => logs.push(args) });
  return { ...module.exports, calls, logs };
}
const req = (query = '') => ({ nextUrl: new URL(`https://example.test/api/reporting/hours${query}`) });

test('All Hours is independently assignable, includes help, and cannot authorize sibling reporting APIs', () => {
  assert.equal(PAGE_ACCESS_CATALOG.find(row => row.path === '/reporting/hours').label, 'All Hours');
  const permissions = expandAssignedPermissions(['page:/reporting/hours']);
  assert.ok(permissions.includes('page:/help/all-hours'));
  assert.ok(!permissions.includes('page:/reporting'));
  assert.deepEqual(apiPagePermissions('/api/reporting/hours'), ['page:/reporting/hours']);
  assert.ok(!apiPagePermissions('/api/reporting/project-usage').some(p => permissions.includes(p)));
  const reportingOnly = expandAssignedPermissions(['page:/reporting']);
  assert.ok(!apiPagePermissions('/api/reporting/hours').some(p => reportingOnly.includes(p)));
  const denied = expandAssignedPermissions(['OWNER', '!page:/reporting/hours']);
  assert.ok(!apiPagePermissions('/api/reporting/hours').some(p => denied.includes(p)));
});

test('hours API checks authentication and current independent database access before reading records', async () => {
  for (const [options, status] of [[{ actor: null }, 401], [{ allowed: false }, 403]]) {
    const route = setup(options); const response = await route.GET(req());
    assert.equal(response.status, status); assert.deepEqual(route.calls, []);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
});

test('hours API uses the configured company, supports all history and inclusive dates, and is read only', async () => {
  const route = setup(); const response = await route.GET(req('?from=2026-11-01&through=2026-11-05&companyId=attacker'));
  assert.equal(response.status, 200); assert.deepEqual(route.calls, [['configured', '2026-11-01', '2026-11-05']]);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  await route.GET(req()); assert.deepEqual(route.calls[1], ['configured', '', '']);
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(route[method], undefined);
});

test('invalid dates, missing company and failed reads never return partial totals or sensitive errors', async () => {
  for (const query of ['?from=2026-02-30', '?from=2026-11-06&through=2026-11-05']) {
    const route = setup(); assert.equal((await route.GET(req(query))).status, 400); assert.deepEqual(route.calls, []);
  }
  const missing = setup({ company: '' }); assert.equal((await missing.GET(req())).status, 503); assert.deepEqual(missing.calls, []);
  const route = setup({ fail: true }); const response = await route.GET(req());
  assert.equal(response.status, 503); assert.match((await response.json()).error, /No partial totals/);
  assert.doesNotMatch(JSON.stringify(route.logs), /credentials/);
});

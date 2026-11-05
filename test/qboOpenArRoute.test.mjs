import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server.js';
import * as permissions from '../src/lib/permissions.ts';
import { apiPagePermissions } from '../src/lib/independentPagePermissions.js';
import { resolvePermissionForPath } from '../src/lib/permissionRoutes.js';
import { PAGE_ACCESS_CATALOG } from '../src/lib/pageAccessCatalog.ts';
import { getHelpGuide } from '../src/lib/helpGuides/index.ts';
import * as domain from '../src/lib/qboOpenAr.ts';

function route(email, assigned, active = true, failure = null) {
  const calls = [];
  const imports = {
    'next/server': { NextRequest, NextResponse },
    '@/lib/requestUser': { getRequestUserEmail: async () => email },
    '@/lib/permissions': permissions,
    '@/lib/prisma': { prisma: { $queryRaw: async () => active ? [{ email, permissions: assigned }] : [] } },
    '@/lib/qboOpenAr': domain,
    '@/lib/loadQboOpenAr': Object.fromEntries(['loadQboOpenAr', 'queueQboOpenAr', 'completeQboOpenAr'].map(name => [name, async company => {
      calls.push([name, company]); if (failure) throw failure; return { marker: 'report' };
    }])),
  };
  const code = ts.transpileModule(fs.readFileSync('src/app/api/accounting/open-ar/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${code}})(require,module,module.exports)`, {
    require: id => { assert.ok(id in imports, id); return imports[id]; }, module, console: { error() {} },
    process: { env: { PROCORE_COMPANY_ID: '123' } }, Error,
  });
  return { ...module.exports, calls };
}
test('saved reads and refreshes require active independent A/R permission before any data access', async () => {
  for (const [email, assigned, active, status] of [
    [null, ['ADMIN'], true, 401], ['reader@example.test', [], true, 403],
    ['reader@example.test', ['accounting-project-profitability'], true, 403],
    ['reader@example.test', ['page:/accounting/open-ar'], true, 200],
    ['reader@example.test', ['accounting-open-ar'], true, 200],
    ['admin@example.test', ['ADMIN'], true, 200],
    ['reader@example.test', ['page:/accounting/open-ar'], false, 403],
    ['reader@example.test', ['admin', '!page:/accounting/open-ar'], true, 403],
  ]) {
    const handler = route(email, assigned, active);
    for (const method of ['GET', 'POST']) {
      const response = await handler[method](new NextRequest('https://example.test/api/accounting/open-ar?companyId=untrusted', { method }));
      assert.equal(response.status, method === 'POST' && status === 200 ? 202 : status, `${method} ${assigned}`);
      assert.equal(response.headers.get('cache-control'), 'private, no-store');
    }
    assert.deepEqual(handler.calls, status === 200 ? [['loadQboOpenAr', '123'], ['queueQboOpenAr', '123']] : []);
  }
});
test('refresh polling is protected, validates IDs, and never starts another QBO request', async () => {
  const handler = route('reader@example.test', ['accounting-open-ar']);
  const invalid = await handler.GET(new NextRequest('https://example.test/api/accounting/open-ar?refreshId=bad'));
  assert.equal(invalid.status, 400);
  const response = await handler.GET(new NextRequest('https://example.test/api/accounting/open-ar?refreshId=12345678-1234-1234-1234-123456789012'));
  assert.equal(response.status, 200);
  assert.deepEqual(handler.calls, [['completeQboOpenAr', '123']]);
});
test('refresh errors are explicit, sanitized, and never return success or a replacement zero report', async () => {
  const handler = route('reader@example.test', ['accounting-open-ar'], true, new Error('private database connection detail'));
  const response = await handler.POST(new NextRequest('https://example.test/api/accounting/open-ar', { method: 'POST' }));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.match(body.error, /previous saved report was retained/);
  assert.doesNotMatch(body.error, /private database/);
  assert.equal(body.report, undefined);
});
test('page, API, help and generated employee inventory expose only the intended independent grant', () => {
  for (const path of ['/accounting/open-ar', '/api/accounting/open-ar', '/help/qbo-open-ar']) assert.equal(resolvePermissionForPath(path), 'accounting-open-ar');
  for (const method of ['GET', 'POST']) assert.deepEqual(apiPagePermissions('/api/accounting/open-ar', method), ['page:/accounting/open-ar']);
  const entry = PAGE_ACCESS_CATALOG.find(row => row.path === '/accounting/open-ar');
  assert.equal(entry.label, 'Open A/R'); assert.equal(entry.permission, 'page:/accounting/open-ar');
  assert.ok(permissions.expandAssignedPermissions(['page:/accounting/open-ar']).includes('page:/help/qbo-open-ar'));
  assert.ok(getHelpGuide('qbo-open-ar'));
  assert.match(fs.readFileSync('src/components/Navigation.tsx', 'utf8'), /href: "\/accounting\/open-ar".*page: "accounting-open-ar"/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { resolvePermissionForPath } from '../src/lib/permissionRoutes.js';

const endpoint = '/api/procore/commitments-live/maker/projects';
const route = readFileSync(`src/app${endpoint}/route.ts`, 'utf8');
const compiled = ts.transpileModule(route, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(email = 'commitments-only@example.com', fail = false) {
  const calls = [];
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/requestUser': { getCurrentUserEmail: async () => email },
    '@/lib/procore': { procoreConfig: { companyId: 'configured-company' } },
    '@/lib/prisma': { prisma: { pmcProject: { findMany: async (query) => {
      calls.push(query);
      if (fail) throw new Error('Internal database details');
      return [{ procoreProjectId: '598134326714493', projectNumber: null, projectName: 'Office Slabs', status: null }];
    } } } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((id) => {
    assert.ok(id in mocks, `Unexpected dependency ${id}`);
    return mocks[id];
  }, module, module.exports);
  return { run: module.exports.GET, calls };
}

test('Commitment Maker project selector uses the same permission as the page without opening broad Procore access', () => {
  const grants = ['analytics', 'procore-commitments'];
  assert.ok(grants.includes(resolvePermissionForPath('/procore/commitments-live/maker')));
  assert.ok(grants.includes(resolvePermissionForPath(endpoint)));
  assert.ok(!grants.includes(resolvePermissionForPath('/api/procore/projects')));
  assert.ok(!grants.includes(resolvePermissionForPath('/api/procore/sync/all-projects')));
  const page = readFileSync('src/app/procore/commitments-live/maker/page.tsx', 'utf8');
  assert.ok(page.includes(`fetch("${endpoint}", { cache: "no-store" })`));
  assert.ok(!page.includes('fetch("/api/procore/projects"'));
});

test('selector is company-scoped and returns only project identity and display fields without caching', async () => {
  const fixture = setup();
  const response = await fixture.run();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), [{ id: '598134326714493', number: '', name: 'Office Slabs', status: '' }]);
  assert.deepEqual(fixture.calls[0].where, { companyId: 'configured-company' });
  assert.deepEqual(fixture.calls[0].select, { procoreProjectId: true, projectNumber: true, projectName: true, status: true });
});

test('a signed project link alone cannot enumerate projects', async () => {
  const fixture = setup(null);
  assert.equal((await fixture.run()).status, 401);
  assert.equal(fixture.calls.length, 0);
});

test('project lookup failures remain failures without exposing database details', async () => {
  const response = await setup('commitments-only@example.com', true).run();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Projects could not be loaded.' });
});

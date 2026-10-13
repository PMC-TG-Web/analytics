import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { validateCsrfRequest } from '../src/lib/csrfProtection.ts';
import { resolvePermissionForPath } from '../src/lib/permissionRoutes.js';
const compiled = ts.transpileModule(fs.readFileSync('src/app/api/wip/team/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function setup({ actor = 'pm@example.com', permission = true, active = true, fail = false } = {}) {
  const calls = [];
  const team = { companyId: 'company', projectId: '101', managers: [{ id: '1', name: 'Paradise PM' }] };
  const mocks = {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/prisma': { prisma: {} },
    '@/lib/requestUser': { getRequestUserEmail: async () => actor },
    '@/lib/permissions': { hasDatabasePageAccess: async (_db, _actor, permissionName) => { assert.equal(permissionName, 'wip'); return permission; } },
    '@/lib/csrfProtection': { validateCsrfRequest },
    '@/lib/loadWipPlanning': { wipCompanyId: () => 'company', loadWipPlanning: async () => active ? [{ projectId: '101' }] : [] },
    '@/lib/procore': { getClientCredentialsToken: async () => 'secret', makeRequest: async () => {}, withProcoreLiveApiBypassForAuthenticatedSession: async (_req, fn) => fn() },
    '@/lib/wipProjectTeam': { fetchWipProjectTeam: async (company, project) => { calls.push('fetch'); assert.equal(company, 'company'); assert.equal(project, '101'); if (fail) throw new Error('secret failure'); return team; } },
    '@/lib/wipProjectTeamStore': { saveWipProjectTeam: async data => { calls.push('save'); assert.deepEqual(data, team); } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => { assert.ok(id in mocks, id); return mocks[id]; }, module, module.exports);
  return { ...module.exports, calls };
}
function request(body = { projectId: '101' }, origin = 'http://localhost:3107') {
  const r = new Request('http://localhost:3107/api/wip/team', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  r.cookies = { get: () => undefined }; return r;
}
test('team refresh shares WIP permission and rejects unauthorized, cross-origin and inactive targets before live reads', async () => {
  assert.equal(resolvePermissionForPath('/api/wip/team'), 'wip');
  for (const [config, body, origin, status] of [
    [{ actor: null }, undefined, undefined, 401], [{ permission: false }, undefined, undefined, 403],
    [{}, undefined, 'https://other.example', 403], [{ active: false }, undefined, undefined, 409],
    [{}, { projectId: '../bad' }, undefined, 400],
  ]) { const f = setup(config); assert.equal((await f.POST(request(body, origin))).status, status); assert.deepEqual(f.calls, []); }
});
test('successful refresh saves canonical team; upstream failure preserves the old snapshot without exposing secrets', async () => {
  const good = setup();
  const res = await good.POST(request({ projectId: '101', companyId: 'attacker' }));
  assert.equal(res.status, 200); assert.match(res.headers.get('cache-control'), /no-store/);
  assert.deepEqual(good.calls, ['fetch', 'save']);
  const failed = setup({ fail: true });
  const err = await failed.POST(request());
  assert.equal(err.status, 503); assert.doesNotMatch(await err.text(), /secret/);
  assert.deepEqual(failed.calls, ['fetch']);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync('src/app/api/steel-needs/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function setup({ actor = 'user@example.com', allowed = true, fail = false } = {}) {
  let reads = 0;
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/prisma': { prisma: {} },
    '@/lib/requestUser': { getRequestUserEmail: async () => actor },
    '@/lib/permissions': { hasDatabasePageAccess: async (_db, email, page) => { assert.equal(email, actor); assert.equal(page, 'page:/steel-needs'); return allowed; } },
    '@/lib/loadSteelNeeds': { loadSteelNeeds: async () => { reads++; if (fail) throw Error('private database details'); return { projects: [], loadedAt: 'now', localOnly: false }; } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => { assert.ok(id in mocks); return mocks[id]; }, module, module.exports);
  return { GET: module.exports.GET, reads: () => reads };
}
test('Steel needs denies unauthenticated and unauthorized requests before any source reads', async () => {
  for (const [options, status] of [[{ actor: null }, 401], [{ allowed: false }, 403]]) {
    const fixture = setup(options), response = await fixture.GET({});
    assert.equal(response.status, status); assert.equal(fixture.reads(), 0); assert.match(response.headers.get('Cache-Control'), /private, no-store/);
  }
});
test('Steel needs returns no-store complete reads and reports errors without exposing database details', async () => {
  const response = await setup().GET({}); assert.equal(response.status, 200); assert.match(response.headers.get('Cache-Control'), /no-store/);
  assert.deepEqual((await response.json()).projects, []);
  const failed = await setup({ fail: true }).GET({}); assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /private database/);
});

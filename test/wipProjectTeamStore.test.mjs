import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const compiled = ts.transpileModule(readFileSync('src/lib/wipProjectTeamStore.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function setup(local) {
  const calls = [];
  const mocks = {
    '@/lib/wipLocalStore': { wipLocalStorePath: () => local },
    '@/lib/prisma': { prisma: { procoreProjectStaging: {
      findMany: async query => { calls.push(query); return []; },
      upsert: async query => { calls.push(query); },
    } } },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => mocks[id] || require(id), module, module.exports);
  return { ...module.exports, calls };
}
const snapshot = { version: 1, companyId: '100', projectId: '200', syncedAt: '2026-10-13T10:00:00Z', managers: [{ id: '300', name: 'Paradise PM' }] };
test('local Project Team snapshots are company/project scoped and never write the shared database', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wip-team-test-'));
  try {
    const api = setup(join(directory, 'plans.json'));
    assert.equal((await api.loadWipProjectTeams('100', ['200'])).size, 0);
    await api.saveWipProjectTeam(snapshot);
    assert.deepEqual((await api.loadWipProjectTeams('100', ['200'])).get('200'), snapshot);
    assert.equal((await api.loadWipProjectTeams('101', ['200'])).size, 0);
    assert.equal((await api.loadWipProjectTeams('100', ['201'])).size, 0);
    await api.saveWipProjectTeam({ ...snapshot, managers: [] });
    assert.deepEqual((await api.loadWipProjectTeams('100', ['200'])).get('200').managers, []);
    assert.deepEqual(api.calls, []);
    await assert.rejects(api.loadWipProjectTeams('100', ['../bad']), /identity/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('database snapshots use a separate staging source and explicit company/project identity', async () => {
  const api = setup(null);
  await api.saveWipProjectTeam(snapshot);
  assert.deepEqual(api.calls[0].where.source_companyId_externalId, { source: 'procore_project_team', companyId: '100', externalId: '200' });
  assert.deepEqual(api.calls[0].update.payload, snapshot);
  await api.loadWipProjectTeams('100', ['200']);
  assert.deepEqual(api.calls[1].where, { source: 'procore_project_team', companyId: '100', externalId: { in: ['200'] } });
});

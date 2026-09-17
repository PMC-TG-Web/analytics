import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const module = { exports: {} };
const compiled = ts.transpileModule(readFileSync('src/lib/procoreWbsCache.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
new Function('require', 'module', 'exports', compiled)(id => {
  assert.equal(id, '@/lib/prisma');
  return { prisma: {} };
}, module, module.exports);
const { readCommitmentMakerWbs } = module.exports;
const now = Date.parse('2026-09-17T13:00:00Z');
const records = [{ id: 'wbs', flat_code: '03-300-40-30.C' }];
const options = { companyId: 'company', projectId: 'project', forceLive: false, now: () => now };

test('fresh cached previews avoid all live requests and token acquisition', async () => {
  const result = await readCommitmentMakerWbs({ ...options,
    read: async () => ({ records, fetchedAt: new Date(now - 60_000) }),
    load: async () => assert.fail('Preview must not access Procore'),
  });
  assert.deepEqual(result, records);
});

test('cold and expired previews load and persist live WBS records', async () => {
  for (const snapshot of [null, { records, fetchedAt: new Date(now - 25 * 3_600_000) }, { records: [], fetchedAt: new Date(now) }]) {
    const saved = [];
    const result = await readCommitmentMakerWbs({ ...options, read: async () => snapshot,
      load: async () => records, write: async rows => saved.push(rows),
    });
    assert.deepEqual(result, records);
    assert.deepEqual(saved, [records]);
  }
});

test('creation always validates live and never substitutes cached data for a failed validation', async () => {
  const failure = new Error('Procore unavailable');
  await assert.rejects(readCommitmentMakerWbs({ ...options, forceLive: true,
    read: async () => assert.fail('Create cannot read cached WBS'), load: async () => { throw failure; },
  }), error => error === failure);
  const latest = [{ id: 'new-wbs' }];
  assert.deepEqual(await readCommitmentMakerWbs({ ...options, forceLive: true,
    read: async () => assert.fail('Create cannot read cached WBS'), load: async () => latest, write: async () => {},
  }), latest);
});

test('empty or failed reads do not overwrite a previous complete snapshot', async () => {
  assert.deepEqual(await readCommitmentMakerWbs({ ...options, forceLive: true,
    load: async () => [], write: async () => assert.fail('Do not cache empty reads'),
  }), []);
});

test('route uses the cache only before preview and keeps credentials lazy', () => {
  const route = readFileSync('src/app/api/procore/commitments-live/maker/route.ts', 'utf8');
  assert.match(route, /forceLive: mode === "create", load: loadLiveWbs/);
  assert.match(route, /const requiresLiveProcore = mode === "create";/);
  assert.match(route, /wbsRecordsOverride: workbookWbsRecords/);
  assert.match(route, /workbookWbsRecords && !loadedWbsLive/);
});

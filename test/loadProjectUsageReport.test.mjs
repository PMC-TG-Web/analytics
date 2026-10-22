import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as logic from '../src/lib/projectUsageReport.ts';

const compiled = ts.transpileModule(readFileSync(new URL('../src/lib/loadProjectUsageReport.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

test('loader pages both sources without truncation and keeps identity joins and date filters scoped', async () => {
  const queries = []; const cursors = { Timecard: [], 'Daily log': [] };
  const db = {
    pmcProject: { findMany: async options => { assert.equal(options.where.companyId, 'company'); return []; } },
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join('?'); queries.push(sql);
      const source = sql.includes('FROM "TimecardEntry"') ? 'Timecard' : 'Daily log';
      const cursor = values.find(v => v === '' || /^row-/.test(String(v)));
      cursors[source].push(cursor);
      const count = cursor === '' ? 1000 : 1;
      return Array.from({ length: count }, (_, i) => ({ id: `row-${String((cursor ? 1000 : 0) + i).padStart(5, '0')}`,
        sourceId: `${source}-${cursor}-${i}`, companyId: 'company', projectId: 'p', source,
        date: '2026-10-22', updatedAt: '2026-10-22T00:00:00Z', quantity: 1, costType: 'M', uom: 'EA', metadataMatches: 1 }));
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => {
    if (id === '@/lib/prisma') return { prisma: db };
    if (id === './projectUsageReport.ts') return logic;
    throw new Error(id);
  }, module, module.exports);
  const result = await module.exports.loadProjectUsageReport('company', '', '');
  assert.equal(result.projects[0].timecardHours, 1001); assert.equal(result.materials[0].quantity, 1001);
  assert.deepEqual(cursors.Timecard, ['', 'row-00999']); assert.deepEqual(cursors['Daily log'], ['', 'row-00999']);
  for (const sql of queries) {
    assert.match(sql, /WHERE [tp]\."procoreCompanyId" = \?/);
    assert.match(sql, /FROM latest [tp] WHERE|FROM latest p\s+LEFT JOIN/);
    assert.match(sql, /ORDER BY [tp]\.id LIMIT \?/);
  }
  const logs = queries.find(sql => sql.includes('FROM "ProductivityLog"'));
  assert.match(logs, /i\."procoreProjectId" = p\."procoreProjectId"/);
  assert.match(logs, /i\."procoreCompanyId" = p\."procoreCompanyId"/);
  assert.match(logs, /i\."procorePurchaseOrderContractId" = CASE/);
  assert.match(logs, /a\.source_holder_id = p\."lineItemHolderId"/);
  assert.match(logs, /COUNT\(\*\) = 1/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { crewWeekRange } from '../src/lib/crewScorecard.ts';

const source = readFileSync(new URL('../src/lib/loadCrewScorecard.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;

function setup({ pages = [[], []], nonadvancing = false, failure = false } = {}) {
  const calls = [];
  const rows = Array.from({ length: 500 }, (_, i) => ({ id: `row-${String(i).padStart(4, '0')}` }));
  let timecardCalls = 0;
  const mocks = {
    '@/lib/prisma': { prisma: {
      $queryRaw: async (strings, ...values) => {
        const sql = strings.join('?');
        calls.push({ sql, values });
        if (failure) throw new Error('read failed');
        if (sql.includes('"TimecardEntry"')) {
          timecardCalls += 1;
          if (nonadvancing) return rows;
          return pages[timecardCalls - 1] || [];
        }
        return [];
      },
      employee: { findMany: async args => { calls.push({ employees: args }); return []; } },
      pmcProject: { findMany: async args => { calls.push({ projects: args }); return []; } },
    } },
    '@/lib/estimatingDashboard': { loadEstimatingDashboardProjects: async () => [] },
    './crewScorecard.ts': { crewWeekRange, buildCrewScorecard: input => input },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => { assert.ok(id in mocks, id); return mocks[id]; }, module, module.exports);
  return { ...module.exports, calls, rows };
}

test('source reads page by ID in bounded 500-row requests without dropping the last page', async () => {
  const first = Array.from({ length: 500 }, (_, i) => ({ id: `row-${String(i).padStart(4, '0')}` }));
  const route = setup({ pages: [first, [{ id: 'row-0500' }]] });
  const result = await route.loadCrewScorecard('company', '2026-10-19');
  assert.equal(result.timecards.length, 501);
  const queries = route.calls.filter(call => call.sql?.includes('"TimecardEntry"'));
  assert.equal(queries.length, 2);
  assert.ok(queries.every(call => call.values.includes('company') && call.values.includes(500)));
  assert.ok(queries[1].values.includes('row-0499'));
  assert.ok(queries[0].values.some(value => value instanceof Date && value.toISOString() === '2026-10-19T00:00:00.000Z'));
  assert.ok(queries[0].values.some(value => value instanceof Date && value.toISOString() === '2026-10-26T00:00:00.000Z'));
  assert.deepEqual(route.calls.find(call => call.projects).projects.where, { companyId: 'company' });
});

test('pagination failures and source read errors reject the whole report', async () => {
  await assert.rejects(setup({ nonadvancing: true }).loadCrewScorecard('company', '2026-10-19'), /pagination did not advance/);
  await assert.rejects(setup({ failure: true }).loadCrewScorecard('company', '2026-10-19'), /read failed/);
});

test('date validation precedes reads and there are no writes or live Procore calls', async () => {
  const route = setup();
  await assert.rejects(route.loadCrewScorecard('company', '2026-10-20'), /Monday/);
  assert.deepEqual(route.calls, []);
  assert.doesNotMatch(source, /\$executeRaw|\$queryRawUnsafe|fetch\(|\.create\(|\.update\(|\.delete\(/);
});

test('deduplication precedes date filtering and PO joins retain company, project and holder identity', async () => {
  const route = setup();
  await route.loadCrewScorecard('company', '2026-10-19');
  const queries = route.calls.filter(call => call.sql);
  for (const query of queries) {
    assert.match(query.sql, /WITH latest AS[\s\S]*DISTINCT ON[\s\S]*FROM latest[\s\S]*WHERE .*date >=/);
    assert.match(query.sql, /COALESCE\(.*"procoreUpdatedAt", .*"updatedAt"\) DESC/);
  }
  const production = queries.find(call => call.sql.includes('"ProductivityLog"')).sql;
  assert.match(production, /i\."procoreCompanyId" = p\."procoreCompanyId"/);
  assert.match(production, /i\."procoreProjectId" = p\."procoreProjectId"/);
  assert.match(production, /a\.source_holder_id = p\."lineItemHolderId"/);
  assert.match(production, /a\.target_holder_id ELSE p\."lineItemHolderId"/);
  assert.match(production, /CASE WHEN COUNT\(\*\) = 1/);
  assert.match(production, /"lineItemHolderType" = 'PurchaseOrderContract'/);
  assert.match(production, /p\."lineItemDescription" AS "logDescription"/);
  assert.match(production, /p\."quantityUsed" AS quantity/);
});

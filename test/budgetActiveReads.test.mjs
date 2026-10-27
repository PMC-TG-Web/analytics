import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const rawReadFiles = [
  'src/app/api/analytics/advanced/route.ts',
  'src/app/api/analytics/monthly-hours/route.ts',
  'src/app/api/analytics/commitment-productivity/route.ts',
  'src/app/api/procore/budget-line-items-live/route.ts',
  'src/app/api/procore/budget-line-items-bulk/route.ts',
  'src/app/api/procore/productivity-logs/forms-closeout/route.ts',
  'src/app/api/procore/prime-contracts/clone/route.ts',
  'src/app/api/cron/project-onboarding/route.ts',
  'src/app/api/procore/projects-master/route.ts',
];

// This inventory protects cross-page consistency: a correct sync is not enough
// when one analytics or write-preview query still counts preserved missing rows.
test('current budget reporting and operational previews share the active source view', () => {
  for (const file of rawReadFiles) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /\bFROM\s+budgetlineitems_active\b/i, file);
    assert.doesNotMatch(source, /\b(?:FROM|JOIN)\s+(?:public\.)?budgetlineitems\b/i, file);
  }
  for (const file of [
    'src/lib/ensureQboBudgetReadiness.ts',
    'src/lib/loadSubcontractAllocation.ts',
    'src/app/api/procore/commitments-live/maker/route.ts',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /budgetLineItem\.findMany\(\{\s*where:\s*\{[^}]*sourceMissingAt:\s*null/, file);
  }
});

function projectsMaster(database) {
  const source = readFileSync('src/app/api/procore/projects-master/route.ts', 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/prisma': { prisma: database },
    '@/lib/serverReadCache': {
      buildSearchParamsCacheKey: () => 'fixture', getCachedValue: () => null,
      setCachedValue: () => assert.fail('noCache request must not populate the cache'),
    },
    '@/lib/procoreProjectsCanonicalSql': { buildCanonicalProcoreProjectsCte: () => 'canonical_projects AS (SELECT NULL WHERE FALSE)' },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`);
    return dependencies[id];
  }, module, module.exports);
  return module.exports.GET;
}

test('Projects Master reads current active budgets even while the older materialized aggregate exists', async () => {
  const queries = [];
  const run = projectsMaster({ $queryRawUnsafe: async (sql, ...values) => {
    queries.push({ sql, values });
    if (sql.includes('to_regclass')) return [{
      budgetrelation: 'budgetlineitems_active', budgetaggmvrelation: 'budget_agg_mv',
      bidboardrelation: null, bidboardlatestmvrelation: null, bidsrelation: null, bidformsrelation: null,
      commitmentcontractrelation: null, purchaseordercontractrelation: null, packagesrelation: null,
      commitmentrelation: null, proposalrelation: null, commitmentsaggmvrelation: null,
    }];
    assert.match(sql, /FROM budgetlineitems_active\s+WHERE company_id = \$1/);
    assert.doesNotMatch(sql, /\bFROM budget_agg_mv\b/);
    assert.equal(values[0], 'current-company');
    return sql.includes('SELECT COUNT(*)::int AS total') ? [{ total: 1 }] : [{
      canonical_project_id: 'project', procore_project_id: 'project', company_id: 'current-company',
      project_name: 'Active budget fixture', budget_total_amount: 125, budget_line_item_count: 1, budget_uoms: 'hr',
    }];
  } });
  const response = await run({
    nextUrl: new URL('http://localhost/api/procore/projects-master?companyId=current-company&noCache=true'),
    cookies: { get: () => undefined },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.sources.budgetLineItems, true);
  assert.equal(body.data[0].budgetTotalAmount, 125);
  assert.equal(body.data[0].budgetLineItemCount, 1);
  assert.equal(queries.length, 3);
  assert.equal(response.headers.get('Cache-Control'), 'private, max-age=15, must-revalidate');
});

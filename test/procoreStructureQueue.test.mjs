import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

function queueHarness() {
  const writes = [];
  const module = { exports: {} };
  const compiled = ts.transpileModule(readFileSync('src/lib/procoreSyncQueue.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', compiled)(id => {
    if (id === '@/lib/prisma') return { prisma: {
      $executeRawUnsafe: async (sql, ...values) => { writes.push({ sql, values }); return 7; },
    } };
    return {};
  }, module, module.exports);
  return { queue: module.exports, writes };
}

test('structure discovery uses canonical company/project IDs even before a budget exists', async () => {
  const h = queueHarness();
  assert.equal(await h.queue.seedProjectSyncQueue('company-a', 'nightly_structure'), 7);
  assert.equal(h.writes.length, 1);
  const { sql, values } = h.writes[0];
  assert.deepEqual(values, ['company-a', 'nightly_structure']);
  assert.match(sql, /FROM pmc_projects p/);
  assert.match(sql, /WHERE p\.company_id = \$1/);
  assert.match(sql, /NULLIF\(BTRIM\(p\.procore_project_id\), ''\) IS NOT NULL/);
  assert.match(sql, /p\.company_id,\s*p\.procore_project_id,\s*\$2/);
  assert.doesNotMatch(sql, /FROM budgetlineitems|JOIN budgetlineitems/,
    'a missing first budget import must not exclude the project from discovery');
});

test('structure seeding preserves parked queues and honors explicit internal-project exclusion in the same company', async () => {
  const h = queueHarness();
  await h.queue.seedProjectSyncQueue('company-a', 'nightly_structure');
  const sql = h.writes[0].sql;
  assert.match(sql, /NOT LIKE '%template%'/);
  assert.match(sql, /onboarding\.company_id = p\.company_id/);
  assert.match(sql, /onboarding\.project_id = p\.procore_project_id/);
  assert.match(sql, /onboarding\.dataset = 'project_onboarding'/);
  assert.match(sql, /"reason":"internal_non_job_project"/);
  const conflictUpdate = sql.split('DO UPDATE SET')[1];
  assert.ok(conflictUpdate);
  assert.doesNotMatch(conflictUpdate, /next_run_at|last_error|last_result|failure_count|locked_|last_success_at|last_attempt_at/,
    'discovering canonical projects must not revive retired tests or reset existing progress');
});

test('Actuals keeps its independent historical source scope and retirement policy', async () => {
  const h = queueHarness();
  await h.queue.seedAllProjectSyncQueue('company-a', 'actuals');
  assert.equal(h.writes.length, 2);
  assert.ok(h.writes.every(({ values }) => values[0] === 'company-a' && values[1] === 'actuals'));
  assert.match(h.writes[0].sql, /FROM pmc_projects/);
  assert.match(h.writes[0].sql, /FROM budgetlineitems budget/);
  assert.match(h.writes[1].sql, /Excluded because the project is no longer in the master actuals scope/);
});

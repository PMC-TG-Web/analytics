import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { calculateWipScheduledHours } from '../src/lib/wipScheduledHours.ts';
import { resolvePermissionForPath } from '../src/lib/permissionRoutes.js';
const plan = { source: { estimatedHours: 1200, projectManagementHours: 200, allocatableHours: 1000, bidBoardId: '1', proposalId: '2' }, allocations: [{ month: '2025-11', percent: 8 }, { month: '2026-10', percent: 72 }, { month: '2027-01', percent: 20 }] };
test('scheduled hours use saved hours excluding PM and exact month-years, summing each plan once', () => {
  const report = calculateWipScheduledHours([plan, { ...plan, source: { ...plan.source, allocatableHours: 500 } }]);
  assert.deepEqual(report, { months: { '2025-11': 120, '2026-10': 1080, '2027-01': 300 }, years: ['2025', '2026', '2027'], planCount: 2 });
  assert.equal(Object.values(report.months).reduce((a, b) => a + b, 0), 1500);
  assert.deepEqual(calculateWipScheduledHours([]), { months: {}, years: [], planCount: 0 });
});
test('malformed saved plans fail instead of producing partial totals, while decimal allocations retain precision', () => {
  assert.throws(() => calculateWipScheduledHours([{ ...plan, allocations: [{ month: '2026-10', percent: 99 }] }]), /100/);
  assert.throws(() => calculateWipScheduledHours([{ ...plan, source: { ...plan.source, allocatableHours: NaN } }]), /Invalid/);
  const report = calculateWipScheduledHours([{ ...plan, source: { ...plan.source, allocatableHours: 0.1 }, allocations: [{ month: '2026-10', percent: 33.33 }, { month: '2026-11', percent: 66.67 }] }]);
  assert.equal(report.months['2026-10'], 0.03333);
  assert.equal(report.months['2026-11'], 0.06667);
});
function moduleFrom(file, mocks) {
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => { assert.ok(id in mocks, id); return mocks[id]; }, module, module.exports);
  return module.exports;
}
test('loader uses only local saved plans in local mode and reads all company-scoped saved plans otherwise', async () => {
  const previous = process.env.PROCORE_COMPANY_ID;
  process.env.PROCORE_COMPANY_ID = 'company';
  let local = 'local-file', failed = false;
  const calls = [];
  try {
    const api = moduleFrom('src/lib/loadWipScheduledHours.ts', {
      '@/lib/prisma': { prisma: { wipImportDraft: { count: async () => 1 }, wipPlan: { findMany: async query => { calls.push(query); return [plan]; } } } },
      '@/lib/wipLocalStore': { wipLocalStorePath: () => local, readWipLocalStore: async (path, company) => { assert.equal(path, local); assert.equal(company, 'company'); if (failed) throw new Error('file missing'); return { plans: { '1': plan }, drafts: { '2': { allocations: [{ month: '2026-10', percent: 99 }] } } }; } },
      '@/lib/wipScheduledHours': { calculateWipScheduledHours },
    });
    const report = await api.loadWipScheduledHours();
    assert.equal(report.months['2026-10'], 720); assert.equal(report.excludedDraftCount, 1); assert.equal(report.localOnly, true); assert.equal(calls.length, 0);
    failed = true; await assert.rejects(api.loadWipScheduledHours(), /file missing/); assert.equal(calls.length, 0);
    local = null;
    assert.equal((await api.loadWipScheduledHours()).localOnly, false);
    assert.deepEqual(calls[0], { where: { companyId: 'company' }, select: { projectId: true, source: true, allocations: true } });
  } finally { if (previous === undefined) delete process.env.PROCORE_COMPANY_ID; else process.env.PROCORE_COMPANY_ID = previous; }
});
test('scheduled-hours endpoint requires KPI permission, is uncached and sanitizes data failures', async () => {
  assert.equal(resolvePermissionForPath('/api/kpi/scheduled-hours'), 'kpi');
  let actor = null, allowed = false, fail = false, reads = 0;
  const api = moduleFrom('src/app/api/kpi/scheduled-hours/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/prisma': { prisma: {} },
    '@/lib/requestUser': { getRequestUserEmail: async () => actor },
    '@/lib/permissions': { hasDatabasePageAccess: async (_db, _email, name) => { assert.equal(name, 'kpi'); return allowed; } },
    '@/lib/loadWipScheduledHours': { loadWipScheduledHours: async () => { reads++; if (fail) throw new Error('private database details'); return calculateWipScheduledHours([plan]); } },
  });
  assert.equal((await api.GET({})).status, 401);
  actor = 'viewer@example.com'; assert.equal((await api.GET({})).status, 403); assert.equal(reads, 0);
  allowed = true; const response = await api.GET({}); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private, no-store/);
  fail = true; const error = await api.GET({}); assert.equal(error.status, 503); assert.doesNotMatch(await error.text(), /private database/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { buildWipUnscheduledProjects, calculateWipScheduledSales } from '../src/lib/wipScheduledSales.ts';
import { buildWipProjects } from '../src/lib/wipPlanning.ts';
import { resolvePermissionForPath } from '../src/lib/permissionRoutes.js';

const plan = { source: { bidBoardId: 'bid-1', proposalId: 'proposal', estimatedHours: 1200, projectManagementHours: 200, allocatableHours: 1000 }, allocations: [{ month: '2026-10', percent: 40 }, { month: '2026-11', percent: 40 }, { month: '2027-01', percent: 20 }] };
const project = { bidBoardId: 'bid-1', procoreProjectId: 'project-1', projectName: 'Project X', sales: 100000,
  status: 'In Progress', projectArchived: false, selectedProposalId: 'proposal', hours: 1200,
  pmcGroup: { PM: 200 }, customFields: { estimateLineCount: 10 } };
const canonicalProject = { procoreProjectId: 'project-1', bidBoardId: 'bid-1', projectManager: null };

test('not scheduled uses the active WIP population, preserves drafts and source issues, and excludes saved plans across years', () => {
  const estimates = [project,
    { ...project, procoreProjectId: 'unsaved', bidBoardId: 'bid-2', projectName: 'Same name' },
    { ...project, procoreProjectId: 'draft', bidBoardId: 'bid-3', projectName: 'Same name' },
    { ...project, procoreProjectId: null, bidBoardId: 'unlinked', projectName: 'Unlinked' },
    { ...project, procoreProjectId: 'complete', bidBoardId: 'bid-4', status: 'Complete' },
    { ...project, procoreProjectId: 'accepted', bidBoardId: 'bid-5', status: 'Accepted' },
    { ...project, procoreProjectId: 'archived', bidBoardId: 'bid-6', projectArchived: true },
    { ...project, procoreProjectId: 'missing-lines', bidBoardId: 'bid-7', customFields: { estimateLineCount: 0 } },
  ];
  const canonical = estimates.filter(p => p.procoreProjectId).map(p => ({ ...canonicalProject, procoreProjectId: p.procoreProjectId, bidBoardId: p.bidBoardId }));
  const active = buildWipProjects(estimates, canonical);
  const report = buildWipUnscheduledProjects(active, ['project-1'], ['draft', 'project-1']);
  assert.equal(report.length, 4);
  assert.equal(report.filter(p => p.projectName === 'Same name').length, 2, 'names never merge distinct projects');
  assert.deepEqual(report.find(p => p.projectId === 'unsaved'), { id: 'unsaved', projectId: 'unsaved', projectName: 'Same name', projectNumber: '', customer: '', hours: 1000, status: 'Needs allocation', reason: 'No saved WIP allocation.' });
  assert.equal(report.find(p => p.projectId === 'draft').status, 'Import needs review');
  assert.equal(report.find(p => p.id === 'bid:unlinked').status, 'Needs source review');
  assert.equal(report.find(p => p.projectId === 'missing-lines').hours, null);
  assert.equal(buildWipUnscheduledProjects(active, ['project-1', 'unsaved', 'draft'], ['draft']).length, 2, 'saved projects leave the list, including older-year plans and retained drafts');
});

test('scheduled revenue allocates the full project value by WIP percentages and adds projects by exact month-year', () => {
  const report = calculateWipScheduledSales({ 'project-1': plan, 'project-2': { ...plan, source: { ...plan.source, bidBoardId: 'bid-2' } } }, [project, { ...project, bidBoardId: 'bid-2', procoreProjectId: 'project-2', sales: 50000 }]);
  assert.deepEqual(report.months, { '2026-10': 60000, '2026-11': 60000, '2027-01': 30000 });
  assert.equal(Object.values(report.months).reduce((a,b) => a+b), 150000);
  assert.deepEqual(report.years, ['2026', '2027']);
  assert.equal(report.planCount, 2);
  assert.deepEqual(report.projectsByMonth['2026-10'].map(entry => [entry.id, entry.projectValue, entry.percent, entry.value]), [['project-1',100000,40,40000], ['project-2',50000,40,20000]]);
  // Hours and current status do not reduce the full sales value or erase historical allocations.
  const changedHours = { ...plan, source: { ...plan.source, allocatableHours: 5 } };
  assert.equal(calculateWipScheduledSales({ 'project-1': changedHours }, [{ ...project, status: 'Complete' }]).months['2026-10'], 40000);
  assert.deepEqual(calculateWipScheduledSales({}, [project]).months, {});
});

test('sales matching rejects missing, ambiguous, mismatched, or invalid sources without falling back to names or partial totals', () => {
  for (const projects of [[], [project, project], [{ ...project, bidBoardId: 'wrong' }], [{ ...project, procoreProjectId: 'wrong' }], [{ ...project, sales: NaN }], [{ ...project, sales: 0 }]]) {
    assert.throws(() => calculateWipScheduledSales({ 'project-1': plan }, projects));
  }
  assert.throws(() => calculateWipScheduledSales({ 'project-1': { ...plan, allocations: [{ month: '2026-10', percent: 99 }] } }, [project]), /100/);
  const report = calculateWipScheduledSales({ 'project-1': { ...plan, allocations: [{ month: '2025-11', percent: 33.33 }, { month: '2026-01', percent: 66.67 }] } }, [{ ...project, sales: 1234.56 }]);
  assert.equal(report.months['2025-11'], 411.478848);
  assert.equal(report.months['2026-01'], 823.081152);
});

function moduleFrom(file, mocks) {
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => { assert.ok(id in mocks, id); return mocks[id]; }, module, module.exports);
  return module.exports;
}

test('sales loader excludes local drafts, never falls back on a local failure, and scopes database plans by company', async () => {
  const previous = process.env.PROCORE_COMPANY_ID;
  process.env.PROCORE_COMPANY_ID = 'company';
  let localPath = 'local-file', fail = false;
  const queries = [];
  try {
    const api = moduleFrom('src/lib/loadWipScheduledSales.ts', {
      '@/lib/prisma': { prisma: { pmcProject: { findMany: async query => { assert.deepEqual(query, { where: { companyId: 'company' }, select: { procoreProjectId: true, bidBoardId: true, projectManager: true } }); return [canonicalProject, { ...canonicalProject, procoreProjectId: 'unfinished', bidBoardId: 'draft-bid' }]; } }, wipPlan: { findMany: async query => { queries.push(query); return [{ ...plan, projectId: 'project-1' }]; } }, wipImportDraft: { findMany: async query => { assert.deepEqual(query.where, { companyId: 'company', projectId: { notIn: ['project-1'] } }); return [{ projectId: 'unfinished' }]; } } } },
      '@/lib/estimatingDashboard': { loadEstimatingDashboardProjects: async () => [project, { ...project, procoreProjectId: 'unfinished', bidBoardId: 'draft-bid' }] },
      '@/lib/wipReportStore': { loadWipReportProjects: async (company, occupied) => { assert.equal(company, 'company'); assert.deepEqual(occupied, ['project-1', 'unfinished']); return []; } },
      '@/lib/wipReportTotals': { addWipReportSales: report => report },
      '@/lib/wipLocalStore': { wipLocalStorePath: () => localPath, readWipLocalStore: async (path, company) => { assert.equal(path, localPath); assert.equal(company, 'company'); if (fail) throw new Error('local failure'); return { plans: { 'project-1': plan }, drafts: { unfinished: plan } }; } },
      '@/lib/wipScheduledSales': { calculateWipScheduledSales, buildWipUnscheduledProjects },
      '@/lib/wipPlanning': { buildWipProjects },
    });
    const report = await api.loadWipScheduledSales();
    assert.equal(report.months['2026-10'], 40000); assert.equal(report.excludedDraftCount, 1); assert.equal(report.localOnly, true); assert.equal(queries.length, 0);
    assert.equal(report.unscheduledProjects.length, 1); assert.equal(report.unscheduledProjects[0].status, 'Import needs review');
    fail = true; await assert.rejects(api.loadWipScheduledSales(), /local failure/); assert.equal(queries.length, 0);
    localPath = null; const shared = await api.loadWipScheduledSales(); assert.equal(shared.localOnly, false); assert.equal(shared.excludedDraftCount, 1);
    assert.deepEqual(shared.unscheduledProjects, report.unscheduledProjects);
    assert.deepEqual(queries, [{ where: { companyId: 'company' }, select: { projectId: true, source: true, allocations: true } }]);
  } finally { if (previous === undefined) delete process.env.PROCORE_COMPANY_ID; else process.env.PROCORE_COMPANY_ID = previous; }
});

test('a company with no saved plans still lists its In Progress projects without scheduling any totals', async () => {
  const previous = process.env.PROCORE_COMPANY_ID; process.env.PROCORE_COMPANY_ID = 'company';
  let sourceReads = 0;
  try {
    const api = moduleFrom('src/lib/loadWipScheduledSales.ts', {
      '@/lib/prisma': { prisma: { wipPlan: { findMany: async () => [] }, wipImportDraft: { findMany: async () => [] }, pmcProject: { findMany: async () => [canonicalProject] } } },
      '@/lib/estimatingDashboard': { loadEstimatingDashboardProjects: async () => { sourceReads++; return [project]; } },
      '@/lib/wipLocalStore': { wipLocalStorePath: () => null },
      '@/lib/wipReportStore': { loadWipReportProjects: async () => [] },
      '@/lib/wipReportTotals': { addWipReportSales: report => report },
      '@/lib/wipScheduledSales': { calculateWipScheduledSales, buildWipUnscheduledProjects },
      '@/lib/wipPlanning': { buildWipProjects },
    });
    const report = await api.loadWipScheduledSales();
    assert.equal(sourceReads, 1); assert.equal(report.planCount, 0);
    assert.deepEqual(report.months, {}); assert.equal(report.unscheduledProjects[0].projectId, 'project-1');
  } finally { if (previous === undefined) delete process.env.PROCORE_COMPANY_ID; else process.env.PROCORE_COMPANY_ID = previous; }
});

test('sales endpoint requires KPI permission, returns no-store, and sanitizes source errors', async () => {
  assert.equal(resolvePermissionForPath('/api/kpi/scheduled-sales'), 'kpi');
  let actor = null, allowed = false, fail = false, reads = 0;
  const api = moduleFrom('src/app/api/kpi/scheduled-sales/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/prisma': { prisma: {} },
    '@/lib/requestUser': { getRequestUserEmail: async () => actor },
    '@/lib/permissions': { hasDatabasePageAccess: async (_db, _email, permission) => { assert.equal(permission, 'kpi'); return allowed; } },
    '@/lib/loadWipScheduledSales': { loadWipScheduledSales: async () => { reads++; if (fail) throw new Error('private details'); return calculateWipScheduledSales({ 'project-1': plan }, [project]); } },
  });
  assert.equal((await api.GET({})).status, 401);
  actor = 'viewer@example.com'; assert.equal((await api.GET({})).status, 403); assert.equal(reads, 0);
  allowed = true; const response = await api.GET({}); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  fail = true; const error = await api.GET({}); assert.equal(error.status, 503); assert.doesNotMatch(await error.text(), /private details/);
});

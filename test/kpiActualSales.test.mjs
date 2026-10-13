import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { calculateKpiActualSales } from '../src/lib/kpiActualSales.ts';
import { financialWipSoldDates } from '../src/lib/financialWip.ts';
import { resolvePermissionForPath } from '../src/lib/permissionRoutes.js';

const project = { bidBoardId: 'bid-1', procoreProjectId: 'project-1', projectName: 'Example', projectNumber: '2501', customer: 'Customer', sales: 100000, status: 'In Progress', projectArchived: false };
const dates = new Map([['project-1', { contractDate: '2026-01-31T23:00:00-05:00' }], ['project-2', { contractDate: '2026-01-01' }], ['project-3', { contractDate: '2027-01-01' }]]);
const canonical = [{ procoreProjectId: 'project-1', bidBoardId: 'bid-1' }];

test('actual sales count the full sales value once in the recorded contract month and preserve year boundaries', () => {
  const report = calculateKpiActualSales([project, { ...project, bidBoardId: 'bid-2', procoreProjectId: 'project-2', sales: 50000, status: 'Complete' }, { ...project, bidBoardId: 'bid-3', procoreProjectId: 'project-3', sales: 25000, status: 'Awarded' }], dates, canonical);
  assert.deepEqual(report.months, { '2026-01': 150000, '2027-01': 25000 });
  assert.deepEqual(report.years, ['2026', '2027']);
  assert.equal(report.projects.length, 3);
  assert.equal(report.projects.find(p => p.projectId === 'project-1').contractDate, '2026-01-31');
  assert.deepEqual(report.excluded, []);
});

test('uses exactly Financial WIP project Contract Date; missing dates never fall back to job year or start date', () => {
  const companyId = '598134325805519';
  const fromMirror = financialWipSoldDates([{ companyId, source: 'procore_v1_projects', externalId: 'project-1', procoreProjectId: 'project-1', payload: { custom_fields: { custom_field_598134325926617: { value: '2026-06-30' } }, start_date: '2027-02-01' } }], companyId);
  assert.equal(calculateKpiActualSales([project], fromMirror, canonical).months['2026-06'], 100000);
  for (const date of [null, 'invalid', '2026-02-30']) {
    const report = calculateKpiActualSales([project], new Map([['project-1', { contractDate: date, startDate: '2026-01-01' }]]), canonical);
    assert.deepEqual(report.months, {});
    assert.match(report.excluded[0].reason, /Contract Date/);
  }
});

test('matches explicit canonical IDs, rejects ambiguous bids, and excludes unsold statuses', () => {
  const duplicate = { ...project, bidBoardId: 'other-bid', sales: 999999 };
  assert.equal(calculateKpiActualSales([duplicate, project], dates, canonical).months['2026-01'], 100000);
  const ambiguous = calculateKpiActualSales([duplicate, project], dates, []);
  assert.deepEqual(ambiguous.months, {}); assert.match(ambiguous.excluded[0].reason, /Multiple bids/);
  for (const status of ['Bid Submitted', 'Estimating', 'Lost']) {
    assert.equal(calculateKpiActualSales([{ ...project, status }], dates, canonical).projects.length, 0);
  }
  assert.equal(calculateKpiActualSales([{ ...project, projectArchived: true }], dates, canonical).projects.length, 0);
  assert.match(calculateKpiActualSales([{ ...project, procoreProjectId: null }], dates, canonical).excluded[0].reason, /linked/);
  assert.match(calculateKpiActualSales([{ ...project, sales: NaN }], dates, canonical).excluded[0].reason, /sales value/);
});

test('Accepted projects contribute full value by contract month and still require valid dates and links', () => {
  for (const status of ['Accepted', ' accepted ', 'ACCEPTED']) {
    const report = calculateKpiActualSales([{ ...project, status }], dates, canonical);
    assert.equal(report.months['2026-01'], 100000);
    assert.equal(report.projects.length, 1);
  }
  const accepted = { ...project, status: 'Accepted' };
  assert.match(calculateKpiActualSales([accepted], new Map(), canonical).excluded[0].reason, /Contract Date/);
  assert.match(calculateKpiActualSales([{ ...accepted, procoreProjectId: null }], dates, canonical).excluded[0].reason, /linked/);
  assert.match(calculateKpiActualSales([accepted, { ...accepted, bidBoardId: 'other' }], dates, []).excluded[0].reason, /Multiple bids/);
  assert.equal(calculateKpiActualSales([{ ...accepted, projectArchived: true }], dates, canonical).projects.length, 0);
});

function moduleFrom(file, mocks) {
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(id => { assert.ok(id in mocks, id); return mocks[id]; }, module, module.exports);
  return module.exports;
}

test('loader reuses Financial WIP date loader with company-scoped canonical IDs and propagates failures', async () => {
  const previous = process.env.PROCORE_COMPANY_ID; process.env.PROCORE_COMPANY_ID = 'company';
  let fail = false;
  try {
    const api = moduleFrom('src/lib/loadKpiActualSales.ts', {
      '@/lib/prisma': { prisma: { pmcProject: { findMany: async query => { assert.deepEqual(query, { where: { companyId: 'company' }, select: { procoreProjectId: true, bidBoardId: true } }); return canonical; } } } },
      '@/lib/estimatingDashboard': { loadEstimatingDashboardProjects: async () => [project] },
      '@/lib/loadFinancialSoldDates': { loadFinancialWipSoldDates: async company => { assert.equal(company, 'company'); if (fail) throw new Error('date source failed'); return dates; } },
      '@/lib/kpiActualSales': { calculateKpiActualSales },
    });
    assert.equal((await api.loadKpiActualSales()).months['2026-01'], 100000);
    fail = true; await assert.rejects(api.loadKpiActualSales(), /date source failed/);
  } finally { if (previous === undefined) delete process.env.PROCORE_COMPANY_ID; else process.env.PROCORE_COMPANY_ID = previous; }
});

test('actual-sales endpoint enforces KPI permission and uncached responses without exposing errors', async () => {
  assert.equal(resolvePermissionForPath('/api/kpi/actual-sales'), 'kpi');
  let actor = null, allowed = false, fail = false, reads = 0;
  const api = moduleFrom('src/app/api/kpi/actual-sales/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => Response.json(body, options) } },
    '@/lib/prisma': { prisma: {} },
    '@/lib/requestUser': { getRequestUserEmail: async () => actor },
    '@/lib/permissions': { hasDatabasePageAccess: async (_db, _email, permission) => { assert.equal(permission, 'kpi'); return allowed; } },
    '@/lib/loadKpiActualSales': { loadKpiActualSales: async () => { reads++; if (fail) throw new Error('private details'); return calculateKpiActualSales([project], dates, canonical); } },
  });
  assert.equal((await api.GET({})).status, 401);
  actor = 'viewer@example.com'; assert.equal((await api.GET({})).status, 403); assert.equal(reads, 0);
  allowed = true; const response = await api.GET({}); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  fail = true; const error = await api.GET({}); assert.equal(error.status, 503); assert.doesNotMatch(await error.text(), /private details/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as domain from '../src/lib/billingAnalytics.ts';

test('both saved sources use the same inclusive UTC dates before aggregation and warnings', async () => {
  const base = { companyId: 'company', projectId: 'project', projectName: 'Project', projectNumber: '100',
    updatedAt: '2026-11-08', deletedAt: null, hours: 2, costCode: '01', costCodeName: 'Labor',
    partyName: 'Sub Contractor', status: 'approved', description: 'Subcontractor Hours', notes: null, uom: 'hr' };
  const entries = ['timesheet', 'productivity'].flatMap(source => [
    { ...base, source, id: `${source}-before`, date: '2026-11-05T23:59:59Z', hours: 100 },
    { ...base, source, id: `${source}-start`, date: '2026-11-06T00:00:00Z' },
    { ...base, source, id: `${source}-end`, date: '2026-11-06T23:59:59Z', hours: 3 },
    { ...base, source, id: `${source}-after`, date: '2026-11-07T00:00:00Z', hours: null },
  ]);
  let reads = 0;
  const prisma = { $queryRaw: async (sql, ...values) => {
    reads++;
    assert.match(sql.join('?'), /t\.date >= \? AND t\.date < \?/);
    assert.match(sql.join('?'), /p\.date >= \? AND p\.date < \?/);
    assert.deepEqual(values.map(value => value instanceof Date ? value.toISOString() : value), [
      'company', '2026-11-06T00:00:00.000Z', '2026-11-07T00:00:00.000Z',
      'company', '2026-11-06T00:00:00.000Z', '2026-11-07T00:00:00.000Z',
    ]);
    return entries.filter(entry => new Date(entry.date) >= values[1] && new Date(entry.date) < values[2]);
  } };
  const code = ts.transpileModule(fs.readFileSync('src/lib/loadBillingAnalytics.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Date, require: id => {
    if (id === '@/lib/prisma') return { prisma };
    assert.equal(id, './billingAnalytics'); return domain;
  } });
  const report = await module.exports.loadBillingAnalytics('company', '2026-11-06', '2026-11-06');
  assert.equal(report.from, '2026-11-06');
  assert.equal(report.through, '2026-11-06');
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].timesheetHours, 5);
  assert.equal(report.rows[0].productivityHours, 5);
  assert.equal(report.rows[0].totalHours, 10);
  assert.equal(report.rows[0].entries.length, 4);
  assert.equal(report.warnings.invalidHours, 0);
  await assert.rejects(module.exports.loadBillingAnalytics('company', '2026-02-30', '2026-03-01'));
  assert.equal(reads, 1);
});

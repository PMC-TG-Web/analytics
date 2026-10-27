import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server.js';
import * as permissions from '../src/lib/permissions.ts';
import * as data from '../src/lib/pageLookupData.ts';
import { certificationDaysRemaining, summarizeCertificationExpirations } from '../src/lib/certificationReview.ts';

function compile(file, imports) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', code)(id => {
    assert.ok(id in imports, id); return imports[id];
  }, module, module.exports);
  return module.exports;
}

const cases = [
  ['crew-management/employees', 'crew-management', 'loadCrewEmployees'],
  ['estimating-tools/projects', 'estimating-tools', 'loadEstimatingProjects'],
  ['certifications/employees', 'certifications', 'loadCertificationEmployees'],
  ['certifications/expiration-review', 'certifications', 'loadCertificationReview'],
];

test('lookup handlers reload active permissions and deny unrelated/inactive accounts before any data read', async () => {
  for (const [route, permission, loader] of cases) {
    let email = 'limited@example.test';
    let assigned = [permission];
    let active = true;
    let reads = 0;
    let failure = false;
    const db = { $queryRaw: async (strings, requested) => {
      assert.match(strings.join('?'), /"isActive" = true/);
      assert.equal(requested, email.toLowerCase());
      return active ? [{ email, permissions: assigned }] : [];
    } };
    const helper = compile('src/lib/pageLookupResponse.ts', {
      'next/server': { NextResponse }, './prisma': { prisma: db },
      './requestUser': { getRequestUserEmail: async () => email }, './permissions': permissions,
    });
    const handler = compile(`src/app/api/${route}/route.ts`, {
      'next/server': { NextRequest }, '@/lib/prisma': { prisma: db },
      '@/lib/pageLookupResponse': helper,
      '@/lib/pageLookupData': { [loader]: async () => { reads++; if (failure) throw Error('private database detail'); return [{ id: 'option-1' }]; } },
    });
    assert.deepEqual(Object.keys(handler).sort(), ['GET', 'dynamic']);
    const request = new NextRequest(`https://example.test/api/${route}?includePrivate=true`);
    const response = await handler.GET(request);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { success: true, data: [{ id: 'option-1' }] });
    active = false;
    assert.equal((await handler.GET(request)).status, 403);
    active = true; assigned = ['analytics'];
    assert.equal((await handler.GET(request)).status, 403);
    email = null;
    assert.equal((await handler.GET(request)).status, 401);
    assert.equal(reads, 1);
    email = 'limited@example.test'; assigned = [permission]; failure = true;
    const failed = await handler.GET(request);
    assert.equal(failed.status, 500);
    assert.doesNotMatch(await failed.text(), /private database detail/);
  }
});

function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return value.every(clause => matches(row, clause));
    if (key === 'OR') return value.some(clause => matches(row, clause));
    if (value && typeof value === 'object' && 'notIn' in value) return !value.notIn.includes(row[key]);
    return row[key] === value;
  });
}
function model(rows) {
  return { findMany: async ({ where = {}, select, take, skip = 0 }) => rows.filter(row => matches(row, where))
    .slice(skip, take === undefined ? undefined : skip + take)
    .map(row => Object.fromEntries(Object.keys(select).map(key => [key, row[key]]))) };
}

test('crew and certification options include more than 100 active people without HR/private fields', async () => {
  const people = Array.from({ length: 132 }, (_, i) => ({ id: `employee-${i}`, firstName: 'First', lastName: `Last${i}`,
    jobTitle: 'Laborer', isActive: i !== 131, email: 'private@example.test', hourlyRate: 100, customFields: { permissions: ['ADMIN'] } }));
  const db = { employee: model(people) };
  const crew = await data.loadCrewEmployees(db);
  const certs = await data.loadCertificationEmployees(db);
  assert.equal(crew.length, 131); assert.equal(certs.length, 131);
  assert.deepEqual(Object.keys(crew[0]).sort(), ['firstName', 'id', 'isActive', 'jobTitle', 'lastName']);
  assert.deepEqual(Object.keys(certs[0]).sort(), ['firstName', 'id', 'lastName']);
});

test('estimating options retain local IDs and same-name projects, exclude lost/archived rows, and omit financial details', async () => {
  const rows = Array.from({ length: 130 }, (_, i) => ({ id: `local-${i}`, procoreId: `external-${i}`,
    projectName: 'Same name', projectNumber: 'Same number', customer: 'Customer', sales: 50000, cost: 10000,
    projectArchived: i === 129, status: i === 128 ? 'Lost' : i === 127 ? 'Archived' : null }));
  rows[0].projectArchived = null;
  const projects = await data.loadEstimatingProjects({ project: model(rows) });
  assert.equal(projects.length, 127);
  assert.equal(new Set(projects.map(p => p.id)).size, 127);
  assert.equal(projects[0].id, 'local-0');
  assert.deepEqual(Object.keys(projects[0]).sort(), ['customer', 'id', 'projectName', 'projectNumber']);
});

test('expiration review returns all saved credentials with searchable employee names', async () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ id: `cert-${i}`, employeeId: 'employee-1', type: 'OSHA',
    issueDate: '', expirationDate: '2026-10-27', notes: null, employee: { firstName: 'Alex', lastName: 'Example' } }));
  const result = await data.loadCertificationReview({ certification: model(rows) });
  assert.equal(result.length, 120);
  assert.equal(result[0].employeeName, 'Alex Example');
  assert.equal('employee' in result[0], false);
});

test('expiration review respects business calendar days, invalid dates, and 30/90-day boundaries', () => {
  const now = new Date('2026-10-28T02:00:00Z'); // October 27 in Pennsylvania.
  assert.equal(certificationDaysRemaining('2026-10-27', now), 0);
  assert.equal(certificationDaysRemaining('2026-10-26', now), -1);
  assert.equal(certificationDaysRemaining('2026-02-30', now), null);
  assert.equal(certificationDaysRemaining('', now), null);
  const dates = ['2026-10-26', '2026-10-27', '2026-11-26', '2026-11-27', '2027-01-25', '2027-01-26', ''];
  assert.deepEqual(summarizeCertificationExpirations(dates.map(expirationDate => ({ expirationDate })), now),
    { total: 7, expired: 1, expiring30: 2, expiring90: 4, missingDate: 1 });
});

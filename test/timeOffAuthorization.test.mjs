import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expandAssignedPermissions } from '../src/lib/permissions.ts';

const compiledRoute = ts.transpileModule(
  readFileSync(new URL('../src/app/api/time-off/route.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

const employee = (extra = {}) => ({
  id: 'employee-self', email: 'person@example.test', firstName: 'Current', lastName: 'Employee', isActive: true, ...extra,
});
const user = (extra = {}) => ({ email: 'person@example.test', isActive: true, permissions: [], ...extra });
const record = (extra = {}) => ({
  id: 'time-off-self', employeeId: 'employee-self', employeeName: 'Current Employee',
  dates: ['2026-11-03'], reason: 'Time off', status: 'approved', ...extra,
});
const validBody = {
  employeeId: 'employee-self', startDate: '2026-11-03', endDate: '2026-11-04', type: 'Vacation', hours: 8,
};

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => value && typeof value === 'object'
    ? value.mode === 'insensitive'
      ? String(row[key]).toLowerCase() === String(value.equals).toLowerCase()
      : row[key] === value.equals
    : row[key] === value);
}

// All database operations are in-memory fixtures. These tests never load Prisma
// or authentication credentials, and cannot read or mutate real employee data.
function setup(options = {}) {
  const users = structuredClone(options.users ?? [user()]);
  const employees = structuredClone(options.employees ?? [employee(), employee({ id: 'employee-other', email: 'other@example.test' })]);
  const records = structuredClone(options.records ?? [record(), record({ id: 'time-off-other', employeeId: 'employee-other' })]);
  const calls = [];
  const timeOffCalls = [];
  let bodyConsumed = false;
  const prisma = {
    user: {
      findMany: async args => {
        calls.push({ name: 'user.findMany', args });
        if (options.failUserLookup) throw new Error('simulated database unavailable');
        return users.filter(row => matches(row, args.where)).slice(0, args.take);
      },
    },
    employee: {
      findMany: async args => {
        calls.push({ name: 'employee.findMany', args });
        if (options.failEmployeeLookup) throw new Error('simulated database unavailable');
        return employees.filter(row => matches(row, args.where)).slice(0, args.take);
      },
      findUnique: async args => {
        calls.push({ name: 'employee.findUnique', args });
        return employees.find(row => matches(row, args.where)) ?? null;
      },
    },
    timeOffRequest: {
      findMany: async args => {
        timeOffCalls.push({ method: 'findMany', args });
        return records.filter(row => matches(row, args.where));
      },
      create: async args => {
        timeOffCalls.push({ method: 'create', args });
        const created = { id: 'time-off-new', ...structuredClone(args.data) };
        records.push(created);
        return created;
      },
      delete: async args => {
        timeOffCalls.push({ method: 'delete', args });
        return records.find(row => matches(row, args.where));
      },
    },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/prisma': { prisma },
    '@/lib/permissions': { expandAssignedPermissions },
    '@/lib/requestUser': {
      getRequestUserEmail: async () => {
        calls.push({ name: 'session' });
        assert.equal(bodyConsumed, false, 'identity must be resolved before the body is consumed');
        if (options.failSession) throw new Error('simulated session unavailable');
        return options.email === undefined ? 'person@example.test' : options.email;
      },
    },
    '@/lib/dbResilience': {
      getErrorMessage: error => error.message,
      shouldFallbackToEmptyRead: () => true,
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'console', compiledRoute)(
    id => { assert.ok(id in mocks, `unexpected dependency ${id}`); return mocks[id]; },
    module, module.exports, { error: () => {} },
  );
  return {
    ...module.exports, calls, timeOffCalls, users,
    request(body = validBody, query = '') {
      bodyConsumed = false;
      return {
        nextUrl: new URL(`http://localhost:3000/api/time-off${query}`),
        json: async () => { bodyConsumed = true; return body; },
      };
    },
  };
}

test('all time-off operations deny missing sessions before database access', async () => {
  for (const method of ['GET', 'POST', 'DELETE']) {
    const route = setup({ email: null });
    assert.equal((await route[method](route.request(validBody, '?id=time-off-self'))).status, 401);
    assert.deepEqual(route.calls, [{ name: 'session' }]);
    assert.deepEqual(route.timeOffCalls, []);
  }
});

test('inactive, missing, and case-ambiguous User accounts cannot use any time-off operation', async () => {
  for (const users of [[], [user({ isActive: false, permissions: ['ADMIN'] })], [user(), user({ email: 'PERSON@example.test', permissions: ['OWNER'] })]]) {
    for (const method of ['GET', 'POST', 'DELETE']) {
      const route = setup({ users });
      assert.equal((await route[method](route.request(validBody, '?id=time-off-self'))).status, 403);
      assert.deepEqual(route.timeOffCalls, []);
      assert.equal(route.calls.some(call => call.name.startsWith('employee.')), false);
    }
  }
});

test('session and authorization database failures cannot become successful empty reads', async () => {
  for (const options of [{ failSession: true }, { failUserLookup: true }, { failEmployeeLookup: true }]) {
    const route = setup(options);
    const response = await route.GET(route.request());
    assert.equal(response.status, 503);
    assert.equal((await response.json()).success, false);
    assert.deepEqual(route.timeOffCalls, []);
  }
});

test('active users without page grants read only their own records with a unique case-insensitive email match', async () => {
  const route = setup({ email: ' Person@Example.Test ', employees: [employee({ email: 'PERSON@EXAMPLE.TEST' }), employee({ id: 'employee-other', email: 'other@example.test' })] });
  const response = await route.GET(route.request());
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data.map(row => row.id), ['time-off-self']);
  assert.deepEqual(route.timeOffCalls[0].args.where, { employeeId: 'employee-self' });
  assert.deepEqual(route.calls.find(call => call.name === 'employee.findMany').args.where, { email: { equals: 'person@example.test', mode: 'insensitive' } });
});

test('self-service cannot query or create another employee’s time off using supplied IDs or identity fields', async () => {
  for (const method of ['GET', 'POST']) {
    const route = setup();
    const response = await route[method](route.request({ ...validBody, employeeId: 'employee-other', employeeName: 'Current Employee', email: 'other@example.test', permissions: ['OWNER'] }, '?employeeId=employee-other'));
    assert.equal(response.status, 403);
    assert.deepEqual(route.timeOffCalls, []);
    assert.equal(route.calls.some(call => call.name === 'employee.findUnique'), false);
  }
});

test('self-service requires exactly one active employee and never falls back to a name or synthetic ID', async () => {
  for (const employees of [
    [], [employee({ email: 'other@example.test' })], [employee({ isActive: false })],
    [employee(), employee({ id: 'duplicate', email: 'PERSON@example.test' })],
  ]) {
    for (const method of ['GET', 'POST']) {
      const route = setup({ employees });
      assert.equal((await route[method](route.request())).status, 403);
      assert.deepEqual(route.timeOffCalls, []);
    }
  }
});

test('self-service creates only its verified employee and derives the display name from the database', async () => {
  const route = setup();
  const response = await route.POST(route.request({ ...validBody, employeeName: 'Forged name', email: 'other@example.test' }));
  assert.equal(response.status, 200);
  const result = (await response.json()).data;
  assert.equal(result.employeeId, 'employee-self');
  assert.equal(result.employeeName, 'Current Employee');
  assert.deepEqual(result.dates, ['2026-11-03', '2026-11-04']);
  assert.equal(result.hours, 8);
  assert.equal(result.type, 'Vacation');
  assert.deepEqual(route.calls.slice(0, 2).map(call => call.name), ['session', 'user.findMany']);
});

test('HR, employees, dispatch, and long-term schedule grants can read all records or an explicit employee', async () => {
  for (const grant of ['HR', 'employees', 'crew-dispatch', 'long-term-schedule', 'ADMIN', 'OWNER']) {
    const route = setup({ users: [user({ permissions: [grant] })], employees: [] });
    const all = await route.GET(route.request());
    assert.equal(all.status, 200, grant);
    assert.equal((await all.json()).data.length, 2, grant);
    const filtered = await route.GET(route.request(validBody, '?employeeId=employee-other'));
    assert.deepEqual((await filtered.json()).data.map(row => row.id), ['time-off-other'], grant);
    assert.equal(route.calls.some(call => call.name === 'employee.findMany'), false, grant);
  }
});

test('HR, employees, and dispatch may create for another existing employee without having their own profile', async () => {
  for (const grant of ['HR', 'employees', 'crew-dispatch', 'ADMIN', 'OWNER']) {
    const route = setup({ users: [user({ permissions: [grant] })], employees: [employee({ id: 'employee-other', email: 'other@example.test', firstName: 'Another' })] });
    const response = await route.POST(route.request({ ...validBody, employeeId: 'employee-other' }));
    assert.equal(response.status, 200, grant);
    assert.equal((await response.json()).data.employeeName, 'Another Employee', grant);
    assert.equal(route.timeOffCalls[0].args.data.employeeId, 'employee-other', grant);
  }
});

test('schedule read grants do not grant another employee’s create or delete authority', async () => {
  const route = setup({ users: [user({ permissions: ['long-term-schedule'] })] });
  assert.equal((await route.POST(route.request({ ...validBody, employeeId: 'employee-other' }))).status, 403);
  assert.equal((await route.DELETE(route.request(validBody, '?id=time-off-other'))).status, 403);
  assert.deepEqual(route.timeOffCalls, []);
  assert.equal((await route.POST(route.request())).status, 200, 'own self-service remains available');
});

test('only employee managers can delete, including when the ID belongs to the caller', async () => {
  for (const permissions of [[], ['home'], ['crew-dispatch'], ['long-term-schedule']]) {
    const route = setup({ users: [user({ permissions })] });
    assert.equal((await route.DELETE(route.request(validBody, '?id=time-off-self'))).status, 403);
    assert.deepEqual(route.timeOffCalls, []);
  }
  for (const grant of ['HR', 'employees', 'ADMIN', 'OWNER']) {
    const route = setup({ users: [user({ permissions: [grant] })] });
    assert.equal((await route.DELETE(route.request(validBody, '?id=time-off-other'))).status, 200, grant);
    assert.deepEqual(route.timeOffCalls, [{ method: 'delete', args: { where: { id: 'time-off-other' } } }]);
  }
});

test('revoking a manager grant takes effect on the next request rather than using cached access', async () => {
  const route = setup({ users: [user({ permissions: ['employees'] })] });
  assert.equal((await route.GET(route.request())).status, 200);
  assert.deepEqual(route.timeOffCalls[0].args.where, {});
  route.users[0].permissions = [];
  assert.equal((await route.GET(route.request(validBody, '?employeeId=employee-other'))).status, 403);
  assert.equal(route.timeOffCalls.length, 1);
  route.users[0].isActive = false;
  assert.equal((await route.POST(route.request())).status, 403);
  assert.equal(route.timeOffCalls.length, 1);
});

test('direct permission grants use the same case-insensitive matching as middleware', async () => {
  for (const grant of ['EMPLOYEES', 'CREW-DISPATCH', 'LONG-TERM-SCHEDULE']) {
    const route = setup({ users: [user({ permissions: [grant] })] });
    const response = await route.GET(route.request());
    assert.equal(response.status, 200, grant);
    assert.equal((await response.json()).data.length, 2, grant);

    const created = await route.POST(route.request({ ...validBody, employeeId: 'employee-other' }));
    assert.equal(created.status, grant === 'LONG-TERM-SCHEDULE' ? 403 : 200, grant);
    const deleted = await route.DELETE(route.request(validBody, '?id=time-off-other'));
    assert.equal(deleted.status, grant === 'EMPLOYEES' ? 200 : 403, grant);
  }
});

test('authorized creation still validates dates and refuses nonexistent employee IDs', async () => {
  const route = setup({ users: [user({ permissions: ['employees'] })] });
  assert.equal((await route.POST(route.request({ ...validBody, employeeId: 'synthetic-id' }))).status, 404);
  assert.equal((await route.POST(route.request({ ...validBody, endDate: '2026-11-01' }))).status, 400);
  assert.equal((await route.POST(route.request({ ...validBody, startDate: '' }))).status, 400);
  assert.deepEqual(route.timeOffCalls, []);
});

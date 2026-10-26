import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as permissions from '../src/lib/permissions.ts';

const compiledRoutes = new Map();
for (const name of ['employees', 'permission-templates', 'estimating-constants']) {
  compiledRoutes.set(name, ts.transpileModule(
    readFileSync(new URL(`../src/app/api/${name}/route.ts`, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText);
}
const policyModule = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(
  readFileSync(new URL('../src/lib/permissionTemplatePolicy.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText)(id => { assert.equal(id, './permissions'); return permissions; }, policyModule, policyModule.exports);

const employee = (extra = {}) => ({
  id: 'employee-1', firstName: 'Alex', lastName: 'Example', jobTitle: 'Office staff',
  email: 'alex@example.test', phone: '555-0100', isActive: true, customFields: {},
  createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-01T00:00:00Z'),
  ...extra,
});
const user = (extra = {}) => ({ email: 'alex@example.test', permissions: ['employees'], isActive: true, ...extra });
const constant = (extra = {}) => ({ id: 'constant-1', name: 'ordinary-rate', value: '10', category: 'General', ...extra });
const request = (body = {}, query = '') => ({
  nextUrl: new URL(`http://localhost:3000/api/example${query}`), json: async () => body,
});

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(clause => matches(row, clause));
    if (key === 'AND') return value.every(clause => matches(row, clause));
    if (value && typeof value === 'object') {
      if ('in' in value) return value.mode === 'insensitive'
        ? value.in.some(candidate => String(candidate).toLowerCase() === String(row[key]).toLowerCase())
        : value.in.includes(row[key]);
      if ('equals' in value) return value.mode === 'insensitive'
        ? String(row[key]).toLowerCase() === String(value.equals).toLowerCase()
        : row[key] === value.equals;
      if ('startsWith' in value) return row[key]?.startsWith(value.startsWith);
    }
    return row[key] === value;
  });
}

// The in-memory database exercises route behavior and callback transaction rollback;
// it never imports the shared Prisma client or connects to a database.
function setup(name = 'employees', options = {}) {
  const actor = {
    email: 'hr@example.test', permissions: ['HR'], canManageAccess: false, canEditEmployees: true,
    ...options.actor,
  };
  let state = structuredClone({
    employee: options.employees ?? [employee()],
    user: options.users ?? [],
    estimatingConstant: options.constants ?? [],
  });
  const writes = [];
  const calls = [];
  const invalidations = [];
  let transactionDepth = 0;
  const prisma = {};
  for (const table of ['employee', 'user', 'estimatingConstant']) {
    const find = where => state[table].find(row => matches(row, where));
    const recordWrite = (method, args) => {
      writes.push({ table, method, args: structuredClone(args), inTransaction: transactionDepth > 0 });
      if (options.failUserWrite && table === 'user') throw new Error('simulated user write failure');
    };
    prisma[table] = {
      findUnique: async ({ where }) => { calls.push(`${table}.findUnique`); return structuredClone(find(where) ?? null); },
      findFirst: async ({ where }) => { calls.push(`${table}.findFirst`); return structuredClone(find(where) ?? null); },
      findMany: async ({ where } = {}) => { calls.push(`${table}.findMany`); return structuredClone(state[table].filter(row => matches(row, where))); },
      count: async ({ where } = {}) => state[table].filter(row => matches(row, where)).length,
      create: async args => {
        recordWrite('create', args);
        const row = { ...(table === 'employee' ? employee({ id: 'employee-new' }) : { id: `${table}-new` }), ...args.data };
        state[table].push(row);
        return structuredClone(row);
      },
      update: async args => {
        recordWrite('update', args);
        const row = find(args.where);
        if (!row) throw new Error('record not found');
        Object.assign(row, args.data);
        return structuredClone(row);
      },
      updateMany: async args => {
        recordWrite('updateMany', args);
        const rows = state[table].filter(row => matches(row, args.where));
        rows.forEach(row => Object.assign(row, args.data));
        return { count: rows.length };
      },
      upsert: async args => {
        recordWrite('upsert', args);
        let row = find(args.where);
        if (row) Object.assign(row, args.update);
        else { row = { ...args.create }; state[table].push(row); }
        return structuredClone(row);
      },
      delete: async args => {
        recordWrite('delete', args);
        const row = find(args.where);
        if (!row) throw new Error('record not found');
        state[table] = state[table].filter(candidate => candidate !== row);
        return structuredClone(row);
      },
      deleteMany: async args => {
        recordWrite('deleteMany', args);
        const before = state[table].length;
        state[table] = state[table].filter(row => !matches(row, args.where));
        return { count: before - state[table].length };
      },
    };
  }
  prisma.$transaction = async callback => {
    assert.equal(typeof callback, 'function', 'mutations use an interactive transaction');
    const before = structuredClone(state);
    transactionDepth += 1;
    try { return await callback(prisma); }
    catch (error) { state = before; throw error; }
    finally { transactionDepth -= 1; }
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/prisma': { prisma },
    '@/lib/dbResilience': { getErrorMessage: error => error.message, shouldFallbackToEmptyRead: () => false },
    '@/lib/permissions': permissions,
    '@/lib/permissionTemplatePolicy': policyModule.exports,
    '@/lib/accessManagement': {
      getAccessManagementActor: async () => { calls.push('actor'); return actor; },
      requireAccessAdministrator: async () => {
        calls.push('administrator');
        return actor.email && actor.canManageAccess
          ? { authorized: true, email: actor.email }
          : { authorized: false, response: Response.json({ success: false }, { status: actor.email ? 403 : 401 }) };
      },
    },
    '@/lib/serverReadCache': {
      buildSearchParamsCacheKey: () => 'cache-key', getCachedValue: () => null,
      setCachedValue: () => {}, invalidateCacheByPrefix: prefix => invalidations.push(prefix),
    },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'console', compiledRoutes.get(name))(
    id => { assert.ok(id in mocks, `unexpected dependency ${id}`); return mocks[id]; },
    module, module.exports, { error: () => {}, warn: () => {} },
  );
  return { ...module.exports, writes, calls, invalidations, get state() { return state; } };
}

const administrator = { email: 'administrator@example.test', permissions: ['ADMIN'], canManageAccess: true, canEditEmployees: true };
const noUserWrites = route => assert.deepEqual(route.writes.filter(write => write.table === 'user'), []);

test('employee mutations require an authenticated actor with employee access before any write', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    for (const [actor, status] of [
      [{ email: null, permissions: [], canEditEmployees: false }, 401],
      [{ permissions: ['FIELD'], canEditEmployees: false }, 403],
    ]) {
      const route = setup('employees', { actor });
      const response = await route[method](request({ id: 'employee-1', firstName: 'Alex', lastName: 'Example' }, '?id=employee-1'));
      assert.equal(response.status, status, method);
      assert.deepEqual(route.writes, []);
    }
  }
});

test('employee editors cannot submit permissions through top-level or either legacy custom-field spelling', async () => {
  for (const method of ['POST', 'PUT']) {
    for (const value of [['ADMIN'], [], null]) {
      for (const accessFields of [
        { navigationPermissions: value },
        { customFields: { navigationPermissions: value } },
        { customFields: { NavigationPermissions: value } },
      ]) {
        const route = setup();
        const response = await route[method](request({ id: 'employee-1', firstName: 'Alex', lastName: 'Example', ...accessFields }));
        assert.equal(response.status, 403, `${method}: ${JSON.stringify(accessFields)}`);
        assert.deepEqual(route.writes, []);
      }
    }
  }
});

test('creating employees or saving job titles never implicitly grants a login or template permissions', async () => {
  for (const actor of [{}, administrator]) {
    for (const method of ['POST', 'PUT']) {
      for (const jobTitle of ['Owner', 'Administrator', 'Estimator', 'Custom role']) {
        const route = setup('employees', { actor, constants: [constant({
          name: 'job-title-template:custom role', category: 'PermissionTemplate', value: JSON.stringify(['admin']),
        })] });
        const response = await route[method](request({ id: 'employee-1', firstName: 'Alex', lastName: 'Example', email: 'alex@example.test', jobTitle }));
        assert.equal(response.status, 200, `${method}: ${jobTitle}`);
        noUserWrites(route);
        assert.deepEqual(route.state.user, []);
      }
    }
  }
});

test('ordinary profile edits preserve existing assigned access and never reactivate disabled users', async () => {
  for (const actor of [{}, administrator]) {
    const route = setup('employees', { actor, users: [user({ permissions: ['FIELD'], isActive: false })] });
    const response = await route.PUT(request({ id: 'employee-1', phone: '555-0199', jobTitle: 'Owner' }));
    assert.equal(response.status, 200);
    assert.equal(route.state.employee[0].phone, '555-0199');
    assert.deepEqual(route.state.user, [user({ permissions: ['FIELD'], isActive: false })]);
    noUserWrites(route);
  }
});

test('linked login identity, activation and deletion are administrator-only even for an inactive account', async () => {
  for (const isActive of [true, false]) {
    for (const [method, body] of [
      ['PUT', { id: 'employee-1', email: 'replacement@example.test' }],
      ['PUT', { id: 'employee-1', isActive: false }],
      ['DELETE', {}],
    ]) {
      const route = setup('employees', { users: [user({ isActive })] });
      const response = await route[method](request(body, '?id=employee-1'));
      assert.equal(response.status, 403, `${method}: ${JSON.stringify(body)}`);
      assert.deepEqual(route.writes, []);
    }
  }
});

test('unchanged linked email and activity in a full profile save do not count as access changes', async () => {
  const route = setup('employees', { users: [user()] });
  assert.equal((await route.PUT(request({ id: 'employee-1', email: 'alex@example.test', isActive: true, phone: '555-0198' }))).status, 200);
  noUserWrites(route);
});

test('employee editors cannot link an employee without a login to another existing account', async () => {
  const route = setup('employees', { users: [user({ email: 'existing-login@example.test' })] });
  const response = await route.PUT(request({ id: 'employee-1', email: 'EXISTING-LOGIN@example.test' }));
  assert.equal(response.status, 403);
  assert.deepEqual(route.writes, []);
});

test('employee editors cannot create a profile linked to an existing login, regardless of email casing or account activity', async () => {
  for (const email of ['existing-login@example.test', 'EXISTING-LOGIN@EXAMPLE.TEST', ' Existing-Login@Example.test ']) {
    for (const isActive of [true, false]) {
      const route = setup('employees', { users: [user({ email: 'Existing-Login@Example.test', isActive })] });
      const response = await route.POST(request({ firstName: 'New', lastName: 'Profile', email }));
      assert.equal(response.status, 403, `${email}, active=${isActive}`);
      assert.deepEqual(route.writes, []);
    }
  }
});

test('employee editors can change email and status or delete employees without login accounts', async () => {
  const route = setup();
  assert.equal((await route.PUT(request({ id: 'employee-1', email: 'replacement@example.test', isActive: false }))).status, 200);
  assert.equal((await route.DELETE(request({}, '?id=employee-1'))).status, 200);
  assert.deepEqual(route.state.employee, []);
  noUserWrites(route);
});

test('employee reads report authoritative User permissions and login-account existence', async () => {
  const route = setup('employees', {
    employees: [
      employee({ customFields: { navigationPermissions: ['ADMIN'] } }),
      employee({ id: 'employee-2', email: 'no-login@example.test', customFields: { NavigationPermissions: ['OWNER'] } }),
      employee({ id: 'employee-3', email: 'empty-access@example.test', customFields: { navigationPermissions: ['OWNER'] } }),
      employee({ id: 'employee-4', email: 'mixed-login@example.test', customFields: { navigationPermissions: ['OWNER'] } }),
    ],
    users: [
      user({ permissions: ['FIELD'], isActive: false }),
      user({ email: 'empty-access@example.test', permissions: [] }),
      user({ email: 'Mixed-Login@Example.test', permissions: ['HR'] }),
    ],
  });
  const response = await route.GET(request());
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.deepEqual(data.map(row => ({ permissions: row.navigationPermissions, hasLoginAccount: row.hasLoginAccount })), [
    { permissions: ['FIELD'], hasLoginAccount: true },
    { permissions: [], hasLoginAccount: false },
    { permissions: [], hasLoginAccount: true },
    { permissions: ['HR'], hasLoginAccount: true },
  ]);
  assert.deepEqual(route.writes, []);
});

test('administrators explicitly grant or clear permissions atomically with the employee write', async () => {
  for (const method of ['POST', 'PUT']) {
    for (const assigned of [['ADMIN'], []]) {
      const route = setup('employees', { actor: administrator, users: [user()] });
      const response = await route[method](request({ id: 'employee-1', firstName: 'Alex', lastName: 'Example', email: 'alex@example.test', navigationPermissions: assigned }));
      assert.equal(response.status, 200);
      assert.deepEqual(route.state.user[0].permissions, assigned);
      assert.ok(route.writes.some(write => write.table === 'employee'));
      assert.ok(route.writes.some(write => write.table === 'user'));
      assert.ok(route.writes.every(write => write.inTransaction));
    }
  }
});

test('a failed administrator permission write rolls back the employee changes', async () => {
  const route = setup('employees', { actor: administrator, users: [user()], failUserWrite: true });
  const response = await route.PUT(request({ id: 'employee-1', firstName: 'Changed', navigationPermissions: ['ADMIN'] }));
  assert.equal(response.status, 500);
  assert.equal(route.state.employee[0].firstName, 'Alex');
  assert.deepEqual(route.state.user, [user()]);
});

test('administrator email changes deactivate the old login without implicitly granting the new email', async () => {
  const route = setup('employees', { actor: administrator, users: [user()] });
  assert.equal((await route.PUT(request({ id: 'employee-1', email: 'replacement@example.test' }))).status, 200);
  assert.equal(route.state.user.length, 1);
  assert.equal(route.state.user[0].isActive, false);
  assert.equal(route.state.employee[0].email, 'replacement@example.test');
  assert.ok(route.writes.every(write => write.inTransaction));
});

test('administrator activity changes and deletion update linked login activity without replacing permissions', async () => {
  for (const [method, body] of [['PUT', { id: 'employee-1', isActive: false }], ['DELETE', {}]]) {
    const route = setup('employees', { actor: administrator, users: [user({ permissions: ['FIELD'] })] });
    assert.equal((await route[method](request(body, '?id=employee-1'))).status, 200);
    assert.equal(route.state.user[0].isActive, false);
    assert.deepEqual(route.state.user[0].permissions, ['FIELD']);
    assert.ok(route.writes.every(write => write.inTransaction));
  }
});

test('permission-template mutation endpoints enforce administrator authorization before writes', async () => {
  for (const method of ['PUT', 'DELETE']) {
    for (const [actor, status] of [[{}, 403], [{ email: null }, 401], [administrator, 200]]) {
      const route = setup('permission-templates', { actor });
      const response = await route[method](request({ jobTitle: 'Office staff', permissions: ['admin'] }, '?jobTitle=Office%20staff'));
      assert.equal(response.status, status, method);
      if (status !== 200) assert.deepEqual(route.writes, []);
      else assert.ok(route.writes.length > 0);
    }
  }
});

test('estimating constants cannot create permission templates through either reserved identity', async () => {
  for (const body of [
    { name: 'job-title-template:office staff', category: 'General', value: '["admin"]' },
    { name: 'ordinary-name', category: 'PermissionTemplate', value: '["admin"]' },
  ]) {
    for (const [actor, status] of [[{}, 403], [{ email: null }, 401], [administrator, 200]]) {
      const route = setup('estimating-constants', { actor });
      assert.equal((await route.POST(request(body))).status, status);
      if (status !== 200) {
        assert.deepEqual(route.writes, []);
        assert.deepEqual(route.invalidations, []);
      }
    }
  }
});

test('estimating constants protect existing templates from value-only edits, renames and deletion', async () => {
  for (const existing of [
    constant({ name: 'job-title-template:office staff' }),
    constant({ category: 'PermissionTemplate' }),
  ]) {
    for (const [method, body] of [
      ['PUT', { id: existing.id, value: '["admin"]' }],
      ['PUT', { id: existing.id, name: 'renamed', category: 'General' }],
      ['DELETE', {}],
    ]) {
      const route = setup('estimating-constants', { constants: [existing] });
      assert.equal((await route[method](request(body, '?id=constant-1'))).status, 403);
      assert.deepEqual(route.writes, []);
      assert.deepEqual(route.invalidations, []);
    }
  }
});

test('estimating constants cannot rename ordinary rows into permission templates without administrator access', async () => {
  for (const changed of [{ name: 'job-title-template:owner' }, { category: 'PermissionTemplate' }]) {
    const route = setup('estimating-constants', { constants: [constant()] });
    assert.equal((await route.PUT(request({ id: 'constant-1', ...changed }))).status, 403);
    assert.deepEqual(route.writes, []);
  }
});

test('ordinary estimating constants remain editable and administrators can maintain reserved templates', async () => {
  for (const [actor, existing] of [[{}, constant()], [administrator, constant({ name: 'job-title-template:office staff', category: 'PermissionTemplate' })]]) {
    const route = setup('estimating-constants', { actor, constants: [existing] });
    assert.equal((await route.PUT(request({ id: existing.id, value: '20' }))).status, 200);
    assert.equal((await route.DELETE(request({}, `?id=${existing.id}`))).status, 200);
    assert.deepEqual(route.state.estimatingConstant, []);
  }
});

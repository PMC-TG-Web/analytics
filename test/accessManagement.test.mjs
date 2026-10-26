import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as permissions from '../src/lib/permissions.ts';

const compiled = ts.transpileModule(
  readFileSync(new URL('../src/lib/accessManagement.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function setup({ email = 'operator@example.test', assigned = [], active = true, failDbRead = false } = {}) {
  let currentAssigned = assigned;
  const queries = [];
  const requests = [];
  const prisma = {
    $queryRaw: async (strings, ...values) => {
      const sql = strings.join('?');
      assert.match(sql, /"isActive"\s*=\s*true/);
      assert.match(sql, /lower\("email"\)\s*=\s*\?/);
      assert.deepEqual(values, [email.toLowerCase()]);
      queries.push({ sql, values });
      if (failDbRead) throw new Error('simulated database lookup failure');
      return active ? [{ email, permissions: currentAssigned }] : [];
    },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    './prisma': { prisma },
    './requestUser': { getRequestUserEmail: async request => { requests.push(request); return email; } },
    './permissions': permissions,
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    id => { assert.ok(id in mocks, `unexpected dependency ${id}`); return mocks[id]; }, module, module.exports,
  );
  return { ...module.exports, queries, requests, setAssigned: value => { currentAssigned = value; } };
}

test('only explicitly assigned OWNER and ADMIN roles can manage access', async () => {
  for (const assigned of [['OWNER'], ['ADMIN'], ['employees', 'OWNER']]) {
    const access = setup({ assigned });
    const actor = await access.getAccessManagementActor({});
    assert.equal(actor.canManageAccess, true);
    assert.equal(actor.canEditEmployees, true);
    const authorization = await access.requireAccessAdministrator({});
    assert.deepEqual(authorization, { authorized: true, email: 'operator@example.test' });
  }
});

test('employee editing or an admin page grant never becomes administrator role authority', async () => {
  for (const assigned of [['HR'], ['employees'], ['admin'], ['owner'], ['ADMIN '], ['employees', 'admin'], []]) {
    const access = setup({ assigned });
    const actor = await access.getAccessManagementActor({});
    assert.equal(actor.canManageAccess, false, JSON.stringify(assigned));
    const result = await access.requireAccessAdministrator({});
    assert.equal(result.authorized, false);
    assert.equal(result.response.status, 403);
  }
  for (const assigned of [['HR'], ['employees']]) {
    assert.equal((await setup({ assigned }).getAccessManagementActor({})).canEditEmployees, true);
  }
  assert.equal((await setup({ assigned: ['FIELD'] }).getAccessManagementActor({})).canEditEmployees, false);
});

test('no identity receives 401 and does not read database permissions', async () => {
  const access = setup({ email: null, assigned: ['ADMIN'] });
  const result = await access.requireAccessAdministrator({});
  assert.equal(result.authorized, false);
  assert.equal(result.response.status, 401);
  assert.deepEqual(access.queries, []);
});

test('inactive database accounts cannot manage access even when their stored roles include ADMIN', async () => {
  const access = setup({ assigned: ['ADMIN'], active: false });
  const actor = await access.getAccessManagementActor({});
  assert.deepEqual(actor.permissions, []);
  assert.equal(actor.canManageAccess, false);
  assert.equal(actor.canEditEmployees, false);
  assert.equal((await access.requireAccessAdministrator({})).response.status, 403);
});

test('every access decision reloads active database grants rather than caching a previous administrator role', async () => {
  const access = setup({ assigned: ['ADMIN'] });
  assert.equal((await access.requireAccessAdministrator({})).authorized, true);
  access.setAssigned(['HR']);
  assert.equal((await access.requireAccessAdministrator({})).response.status, 403);
  assert.equal(access.queries.length, 2);
});

test('failed database permission lookup denies access instead of retaining administrator authority', async context => {
  context.mock.method(console, 'error', () => {});
  const access = setup({ assigned: ['ADMIN'], failDbRead: true });
  const actor = await access.getAccessManagementActor({});
  assert.deepEqual(actor.permissions, []);
  assert.equal(actor.canManageAccess, false);
  assert.equal(actor.canEditEmployees, false);
  const result = await access.requireAccessAdministrator({});
  assert.equal(result.authorized, false);
  assert.equal(result.response.status, 403);
  assert.equal(access.queries.length, 2);
});

test('the authenticated request is passed to the shared identity resolver and client claims do not grant access', async () => {
  const access = setup({ assigned: ['employees'] });
  const request = { headers: new Headers({ 'x-user-permissions': '["ADMIN"]', cookie: 'permissions=ADMIN' }) };
  assert.equal((await access.requireAccessAdministrator(request)).response.status, 403);
  assert.equal(access.requests[0], request);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessNavigationLink, createNavigationPermissionRefresh } from '../src/lib/navigationPermissions.ts';

const email = 'operator@example.test';
const response = (permissions, responseEmail = email) => Response.json({ data: { email: responseEmail, permissions } });

test('Help remains visible to signed-in users with no Home grant or any page grants', () => {
  const help = { href: '/help', page: 'help' };
  for (const permissions of [[], ['crew-dispatch'], ['accounting-project-profitability']]) {
    assert.equal(canAccessNavigationLink(help, { email, permissions, loaded: true, failed: false }), true);
  }
  assert.equal(canAccessNavigationLink(help, { email, permissions: null, loaded: false, failed: true }), true);
  assert.equal(canAccessNavigationLink(help, { email: null, permissions: ['home'], loaded: true, failed: false }), false);
});

test('universal Help does not grant other navigation links or guide routes', () => {
  const state = { email, permissions: [], loaded: true, failed: false };
  assert.equal(canAccessNavigationLink({ href: '/help/qbo-project-profitability', page: 'accounting-project-profitability' }, state), false);
  assert.equal(canAccessNavigationLink({ href: '/accounting/project-profitability', page: 'accounting-project-profitability' }, state), false);
  assert.equal(canAccessNavigationLink({ href: '/kpi', page: 'kpi' }, { ...state, permissions: ['KPI'] }), true);
  assert.equal(canAccessNavigationLink({ href: '/market-outlook', page: 'market-outlook', fallbackPage: 'analytics' }, { ...state, permissions: ['analytics'] }), true);
});

test('an already open menu receives new QBO grants and later revocations', async () => {
  let assigned = ['employees'];
  let menu = ['employees'];
  const refresh = createNavigationPermissionRefresh({
    email,
    fetchPermissions: async () => response(assigned),
    onPermissions: permissions => { menu = permissions; },
    onError: () => assert.fail('unexpected failure'),
  });
  await refresh.refresh();
  assigned = ['employees', 'accounting-direct-cost-bills', 'accounting-project-profitability'];
  await refresh.refresh();
  assert.deepEqual(menu, assigned);
  assigned = [];
  await refresh.refresh();
  assert.deepEqual(menu, []);
  refresh.dispose();
});

test('malformed, failed, or other-user responses preserve the last confirmed menu', async () => {
  for (const result of [response(null), response(['ADMIN'], 'other@example.test'), new Response('', { status: 503 })]) {
    let failed = false;
    const refresh = createNavigationPermissionRefresh({
      email,
      fetchPermissions: async () => result,
      onPermissions: () => assert.fail('untrusted response applied'),
      onError: () => { failed = true; },
    });
    await refresh.refresh();
    assert.equal(failed, true);
    refresh.dispose();
  }
});

test('overlapping refreshes share one read and disposed requests cannot update the next session', async () => {
  let resolve;
  let requests = 0;
  const refresh = createNavigationPermissionRefresh({
    email,
    fetchPermissions: () => { requests++; return new Promise(done => { resolve = done; }); },
    onPermissions: () => assert.fail('late response applied'),
    onError: () => assert.fail('disposed request reported an error'),
  });
  const pending = refresh.refresh();
  await refresh.refresh();
  assert.equal(requests, 1);
  refresh.dispose();
  resolve(response(['ADMIN']));
  await pending;
  await refresh.refresh();
  assert.equal(requests, 1);
});

test('a timed-out read retries once and applies the successful result', async () => {
  let attempts = 0;
  let menu;
  const refresh = createNavigationPermissionRefresh({
    email: email.toUpperCase(),
    fetchPermissions: async () => {
      if (++attempts === 1) throw new DOMException('Timed out', 'AbortError');
      return response(['accounting-direct-cost-bills']);
    },
    onPermissions: permissions => { menu = permissions; },
    onError: () => assert.fail('retry should succeed'),
  });
  await refresh.refresh();
  assert.equal(attempts, 2);
  assert.deepEqual(menu, ['accounting-direct-cost-bills']);
  refresh.dispose();
});

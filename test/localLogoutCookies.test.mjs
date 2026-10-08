import assert from 'node:assert/strict';
import test from 'node:test';
import { localLogoutCookies } from '../src/lib/localLogoutCookies.ts';
import { getDeveloperEmail, isLocalDeveloperRequest } from '../src/lib/developerIdentity.ts';

test('logout removes the dev identity override and cached permissions as well as provider sessions', () => {
  const jar = new Map([
    ['dev_user_email', 'previous@example.invalid'], ['analytics_permissions', 'old-permissions'],
    ['__session', 'old-session'], ['analytics_procore_user', 'old-user'],
    ['analytics_procore_link_access', '1'], ['preference', 'keep'],
  ]);
  for (const cookie of localLogoutCookies([...jar.keys()], false)) {
    assert.equal(cookie.value, '');
    assert.equal(cookie.maxAge, 0);
    assert.equal(cookie.expires.getTime(), 0);
    assert.equal(cookie.path, '/');
    assert.equal(cookie.secure, false);
    assert.equal(cookie.sameSite, 'lax');
    jar.delete(cookie.name);
  }
  assert.deepEqual([...jar], [['preference', 'keep']]);
});

test('logout expires Auth0 session chunks without touching similarly named cookies', () => {
  const cookies = localLogoutCookies(['__session__0', '__session__1', 'appSession.0', 'appSession.1', '__session_other', 'appSession.note'], true);
  const names = cookies.map(cookie => cookie.name);
  for (const name of ['__session__0', '__session__1', 'appSession.0', 'appSession.1']) assert.ok(names.includes(name));
  assert.ok(!names.includes('__session_other'));
  assert.ok(!names.includes('appSession.note'));
  assert.ok(cookies.every(cookie => cookie.secure && cookie.sameSite === 'none'));
});

const request = (hostname, email) => ({
  nextUrl: { hostname },
  cookies: { get: () => email == null ? undefined : { value: email } },
});

test('developer identity is recognized only in local development and normalizes the selected email', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(getDeveloperEmail(request(host, ' New@Example.invalid '), 'development'), 'new@example.invalid');
    assert.equal(getDeveloperEmail(request(host, 'old@example.invalid'), 'production'), null);
    assert.equal(isLocalDeveloperRequest(request(host), 'production'), false);
  }
  for (const host of ['analyticspmc.netlify.app', 'localhost.evil.example', '192.168.1.20']) {
    assert.equal(getDeveloperEmail(request(host, 'old@example.invalid'), 'development'), null);
    assert.equal(isLocalDeveloperRequest(request(host), 'development'), false);
  }
  assert.equal(getDeveloperEmail(request('localhost'), 'development'), null);
  assert.equal(getDeveloperEmail(request('localhost', 'invalid'), 'development'), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearLoginRedirectGuard,
  LOGIN_REDIRECT_GUARD_KEY,
  LOGIN_REDIRECT_GUARD_WINDOW_MS,
  shouldAutoRedirectFromLogin,
} from '../src/lib/loginRedirectGuard.ts';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
  };
}

test('first auto-redirect is allowed and recorded', () => {
  const storage = memoryStorage();
  assert.equal(shouldAutoRedirectFromLogin(storage, '/help', 1_000), true);
  assert.deepEqual(JSON.parse(storage.getItem(LOGIN_REDIRECT_GUARD_KEY)), { returnTo: '/help', at: 1_000 });
});

test('bouncing straight back to /login for the same destination is refused once, then recovers', () => {
  const storage = memoryStorage();
  assert.equal(shouldAutoRedirectFromLogin(storage, '/help', 1_000), true);
  assert.equal(shouldAutoRedirectFromLogin(storage, '/help', 3_000), false, 'second redirect inside the window is a loop');
  assert.equal(storage.getItem(LOGIN_REDIRECT_GUARD_KEY), null, 'record is cleared so a real login can proceed');
  assert.equal(shouldAutoRedirectFromLogin(storage, '/help', 4_000), true);
});

test('a different destination or an expired record does not count as a loop', () => {
  const storage = memoryStorage();
  assert.equal(shouldAutoRedirectFromLogin(storage, '/help', 1_000), true);
  assert.equal(shouldAutoRedirectFromLogin(storage, '/projects', 2_000), true);
  assert.equal(shouldAutoRedirectFromLogin(storage, '/projects', 2_000 + LOGIN_REDIRECT_GUARD_WINDOW_MS), true);
});

test('missing or failing storage never blocks login', () => {
  assert.equal(shouldAutoRedirectFromLogin(null, '/help'), true);
  const broken = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
    removeItem: () => { throw new Error('blocked'); },
  };
  assert.equal(shouldAutoRedirectFromLogin(broken, '/help'), true);
  assert.doesNotThrow(() => clearLoginRedirectGuard(broken));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAuthReleaseAccounts, validateAuthReleaseConfiguration } from '../src/lib/authReleasePreflight.ts';

const env = { PROCORE_SIGN_IN_ENABLED: 'true', PROCORE_APP_SESSION_SECRET: 'fixture-only-session-secret-over-32-bytes',
  PROCORE_COMPANY_ID: 'company', PROCORE_CLIENT_ID: 'sign-in', PROCORE_CLIENT_SECRET: 'fixture',
  PROCORE_ANALYTICS_SYNC_ENABLED: 'true', PROCORE_ANALYTICS_SYNC_CLIENT_ID: 'sync', PROCORE_ANALYTICS_SYNC_CLIENT_SECRET: 'fixture',
  PROCORE_BILLING_ENABLED: 'true', PROCORE_BILLING_CLIENT_ID: 'billing', PROCORE_BILLING_CLIENT_SECRET: 'fixture' };
const expected = { administrator: 'owner@example.test', analyticsEmployee: 'employee@example.test' };
const accounts = [
  { email: expected.administrator, isActive: true, permissions: ['admin', 'ADMIN'] },
  { email: expected.analyticsEmployee, isActive: true, permissions: ['analytics'] },
];

test('a release requires separate enabled bulk connections and working sign-in configuration', () => {
  assert.doesNotThrow(() => validateAuthReleaseConfiguration(env));
  for (const key of Object.keys(env)) assert.throws(() => validateAuthReleaseConfiguration({ ...env, [key]: '' }), key);
  for (const key of ['PROCORE_ANALYTICS_SYNC_CLIENT_ID', 'PROCORE_BILLING_CLIENT_ID']) {
    assert.throws(() => validateAuthReleaseConfiguration({ ...env, [key]: 'sign-in' }), /distinct/);
  }
  assert.throws(() => validateAuthReleaseConfiguration({ ...env, PROCORE_BILLING_CLIENT_ID: 'sync' }), /distinct/);
});

test('release checks protect owner administration and ordinary employee analytics without modifying accounts', () => {
  const before = structuredClone(accounts);
  assert.doesNotThrow(() => validateAuthReleaseAccounts(accounts, expected));
  assert.deepEqual(accounts, before);
  for (const index of [0, 1]) {
    for (const changes of [{ isActive: false }, { permissions: [] }]) {
      const invalid = structuredClone(accounts); Object.assign(invalid[index], changes);
      assert.throws(() => validateAuthReleaseAccounts(invalid, expected), /Release access check failed/);
    }
    assert.throws(() => validateAuthReleaseAccounts(accounts.filter((_, i) => i !== index), expected), /one active/);
  }
  assert.throws(() => validateAuthReleaseAccounts([{ ...accounts[0], permissions: ['admin'] }, accounts[1]], expected), /cannot manage/);
  assert.throws(() => validateAuthReleaseAccounts([accounts[0], { ...accounts[1], permissions: ['ADMIN'] }], expected), /ordinary analytics/);
  assert.throws(() => validateAuthReleaseAccounts([...accounts, { ...accounts[0], email: accounts[0].email.toUpperCase() }], expected), /one active/);
  for (const invalid of [{}, { administrator: expected.administrator }, { ...expected, analyticsEmployee: expected.administrator }]) {
    assert.throws(() => validateAuthReleaseAccounts(accounts, invalid), /distinct representative/);
  }
});

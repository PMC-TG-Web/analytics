import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getUserPermissions,
  hasPageAccess,
  resolvePermissionForPath,
  USER_PERMISSIONS,
} from '../src/lib/permissions.ts';

Object.keys(USER_PERMISSIONS).forEach((email) => delete USER_PERMISSIONS[email]);
Object.assign(USER_PERMISSIONS, {
  'todd@pmcdecor.com': ['OWNER'],
  'david@pmcdecor.com': ['dashboard', 'employees', 'onboarding'],
});

test('hasPageAccess is case-insensitive for user emails and permission names', () => {
  assert.equal(hasPageAccess('TODD@PMCDECOR.COM', 'DIAGNOSTICS'), true);
  assert.equal(hasPageAccess('john@pmcdecor.com', 'diagnostics'), false);
});

test('getUserPermissions expands group assignments and preserves specific page grants', () => {
  const permissions = getUserPermissions('david@pmcdecor.com');

  assert.ok(permissions.includes('employees'));
  assert.ok(permissions.includes('onboarding'));
  assert.ok(permissions.includes('dashboard'));
  assert.ok(!permissions.includes('diagnostics'));
});

test('resolvePermissionForPath normalizes trailing slashes and protects debug pages explicitly', () => {
  assert.equal(resolvePermissionForPath('/auth0-test/'), 'diagnostics');
  assert.equal(resolvePermissionForPath('/test-schedules'), 'diagnostics');
  assert.equal(resolvePermissionForPath('/debug-cookies'), 'diagnostics');
  assert.equal(resolvePermissionForPath('/seed-kpi-cards'), 'admin');
});

test('resolvePermissionForPath uses more specific rules before broad feature prefixes', () => {
  assert.equal(resolvePermissionForPath('/procore/test'), 'diagnostics');
  assert.equal(resolvePermissionForPath('/procore/review'), 'procore');
  assert.equal(resolvePermissionForPath('/api/procore/test'), 'diagnostics');
  assert.equal(resolvePermissionForPath('/api/procore/sync/all-projects'), 'admin');
  assert.equal(resolvePermissionForPath('/accounting/project-profitability'), 'admin');
  assert.equal(resolvePermissionForPath('/api/accounting/project-profitability'), 'admin');
});

test('QBO profitability access is included only in administrative permission groups', () => {
  assert.equal(hasPageAccess('todd@pmcdecor.com', 'admin'), true);
  assert.equal(hasPageAccess('david@pmcdecor.com', 'admin'), false);
});

test('resolvePermissionForPath falls back to home only for the root page', () => {
  assert.equal(resolvePermissionForPath('/'), 'home');
  assert.equal(resolvePermissionForPath('/unknown-route'), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  getUserPermissions,
  hasPageAccess,
  NAVIGATION_PERMISSION_OPTIONS,
  resolvePermissionForPath,
  USER_PERMISSIONS,
} from '../src/lib/permissions.ts';

Object.keys(USER_PERMISSIONS).forEach((email) => delete USER_PERMISSIONS[email]);
Object.assign(USER_PERMISSIONS, {
  'todd@pmcdecor.com': ['OWNER'],
  'david@pmcdecor.com': ['dashboard', 'employees', 'onboarding'],
});

test('Next.js src entry point wires the existing middleware and matching scope', () => {
  const entry = readFileSync(new URL('../src/middleware.ts', import.meta.url), 'utf8');
  const policy = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
  assert.match(entry, /export \{ middleware \} from '\.\.\/middleware'/);
  const matcher = source => source.match(/matcher:\s*\[([\s\S]*?)\]/)?.[1].trim();
  assert.ok(matcher(entry));
  assert.equal(matcher(entry), matcher(policy));
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
  assert.equal(resolvePermissionForPath('/procore/timecard-entries'), 'procore-timecards');
  assert.equal(resolvePermissionForPath('/procore/proposal-line-items-live'), 'procore-line-items');
  assert.equal(resolvePermissionForPath('/procore/commitments-live'), 'procore-commitments');
  assert.equal(resolvePermissionForPath('/procore/scope-mapping-review'), 'procore-scope-map');
  assert.equal(resolvePermissionForPath('/api/procore/test'), 'diagnostics');
  assert.equal(resolvePermissionForPath('/api/procore/sync/all-projects'), 'admin');
  assert.equal(resolvePermissionForPath('/analytics/cost-code-sales'), 'analytics-cost-code-sales');
  assert.equal(resolvePermissionForPath('/market-outlook'), 'analytics');
  assert.equal(resolvePermissionForPath('/accounting/project-profitability'), 'accounting-project-profitability');
  assert.equal(resolvePermissionForPath('/api/accounting/project-profitability'), 'accounting-project-profitability');
  assert.equal(resolvePermissionForPath('/accounting/direct-cost-bills'), 'accounting-direct-cost-bills');
  assert.equal(resolvePermissionForPath('/api/accounting/direct-cost-bills'), 'accounting-direct-cost-bills');
  assert.equal(resolvePermissionForPath('/api/accounting/direct-cost-bills/sync'), 'accounting-direct-cost-bills');
  assert.equal(resolvePermissionForPath('/api/accounting/direct-cost-bills/setup'), 'accounting-direct-cost-bills');
  assert.equal(resolvePermissionForPath('/api/accounting/direct-cost-bills/food-total'), 'accounting-direct-cost-bills');
  assert.equal(resolvePermissionForPath('/api/accounting/direct-cost-bills/reconcile'), 'accounting-direct-cost-bills');
  assert.equal(resolvePermissionForPath('/api/accounting/direct-cost-bills/catalog-mapping'), 'accounting-direct-cost-bills');
  assert.equal(resolvePermissionForPath('/pm-dashboard'), 'pm-dashboard');
  assert.equal(resolvePermissionForPath('/api/pm-dashboard'), 'pm-dashboard');
  assert.equal(resolvePermissionForPath('/analytics/productivity'), 'analytics');
  assert.equal(resolvePermissionForPath('/api/analytics/commitment-productivity/reviews'), 'analytics');
});

test('employee templates include every page-specific navigation permission', () => {
  for (const permission of [
    'procore-timecards',
    'procore-line-items',
    'procore-commitments',
    'procore-scope-map',
    'analytics-cost-code-sales',
    'accounting-project-profitability',
    'accounting-direct-cost-bills',
    'pm-dashboard',
  ]) {
    assert.ok(NAVIGATION_PERMISSION_OPTIONS.includes(permission), `${permission} is missing`);
  }
});

test('project manager permissions include the personal work queue', () => {
  USER_PERMISSIONS['pm@pmcdecor.com'] = ['PMs'];
  assert.equal(hasPageAccess('pm@pmcdecor.com', 'pm-dashboard'), true);
});

test('QBO profitability access is included only in administrative permission groups', () => {
  assert.equal(hasPageAccess('todd@pmcdecor.com', 'admin'), true);
  assert.equal(hasPageAccess('david@pmcdecor.com', 'admin'), false);
});

test('resolvePermissionForPath falls back to home only for the root page', () => {
  assert.equal(resolvePermissionForPath('/'), 'home');
  assert.equal(resolvePermissionForPath('/unknown-route'), null);
});

test('direct cost bills can be granted independently of QBO profitability', () => {
  USER_PERMISSIONS['bill-operator@example.test'] = ['accounting-direct-cost-bills'];
  USER_PERMISSIONS['profitability-reader@example.test'] = ['accounting-project-profitability'];
  try {
    assert.equal(hasPageAccess('bill-operator@example.test', 'accounting-direct-cost-bills'), true);
    assert.equal(hasPageAccess('bill-operator@example.test', 'accounting-project-profitability'), false);
    assert.equal(hasPageAccess('profitability-reader@example.test', 'accounting-direct-cost-bills'), false);
    const employeeSource = readFileSync(new URL('../src/app/employees/page.tsx', import.meta.url), 'utf8');
    assert.match(employeeSource, /'accounting-direct-cost-bills': 'QBO Direct Costs'/);
  } finally {
    delete USER_PERMISSIONS['bill-operator@example.test'];
    delete USER_PERMISSIONS['profitability-reader@example.test'];
  }
});

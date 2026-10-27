import { analyticsSyncProcoreConnection, billingProcoreConnection } from './procoreConnection.ts';
import { expandAssignedPermissions, hasAccessAdministratorRole } from './permissions.ts';

type AccessAccount = { email: string; isActive: boolean; permissions: string[] };

export function validateAuthReleaseConfiguration(env: NodeJS.ProcessEnv) {
  if (!['true', '1', 'yes'].includes((env.PROCORE_SIGN_IN_ENABLED || '').trim().toLowerCase())) {
    throw new Error('Production Procore sign-in must remain enabled.');
  }
  for (const key of ['PROCORE_CLIENT_ID', 'PROCORE_CLIENT_SECRET', 'PROCORE_COMPANY_ID']) {
    if (!env[key]?.trim()) throw new Error(`Missing ${key}.`);
  }
  if (Buffer.byteLength(env.PROCORE_APP_SESSION_SECRET || '') < 32) throw new Error('Invalid PROCORE_APP_SESSION_SECRET.');
  analyticsSyncProcoreConnection(env);
  billingProcoreConnection(env);
}

export function validateAuthReleaseAccounts(accounts: AccessAccount[], expected: { administrator: string; analyticsEmployee: string }) {
  if (!expected || Object.keys(expected).sort().join(',') !== 'administrator,analyticsEmployee'
    || Object.values(expected).some(email => typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    || expected.administrator.toLowerCase() === expected.analyticsEmployee.toLowerCase()) {
    throw new Error('Release access check failed: configure distinct representative accounts.');
  }
  for (const [role, email] of Object.entries(expected)) {
    const matches = accounts.filter(account => account.email.toLowerCase() === email.toLowerCase());
    if (matches.length !== 1 || !matches[0].isActive) throw new Error(`Release access check failed: ${role} must have one active account.`);
    const assigned = matches[0].permissions;
    const pages = expandAssignedPermissions(assigned);
    if (role === 'administrator' && (!hasAccessAdministratorRole(assigned) || !pages.includes('employees'))) {
      throw new Error('Release access check failed: administrator cannot manage employee access.');
    }
    if (role === 'analyticsEmployee' && (!pages.includes('analytics') || hasAccessAdministratorRole(assigned))) {
      throw new Error('Release access check failed: analytics employee must retain ordinary analytics access.');
    }
  }
}

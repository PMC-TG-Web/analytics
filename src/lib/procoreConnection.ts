import { AsyncLocalStorage } from 'node:async_hooks';

export type ProcoreConnection = 'shared' | 'pm-dashboard' | 'commitment-maker';
const connectionContext = new AsyncLocalStorage<ProcoreConnection>();

export function pmDashboardProcoreConnection(env: NodeJS.ProcessEnv = process.env): ProcoreConnection {
  const id = env.PROCORE_PM_DASHBOARD_CLIENT_ID?.trim();
  const secret = env.PROCORE_PM_DASHBOARD_CLIENT_SECRET?.trim();
  // Preserve the existing connection until the separate app is configured.
  if (!id && !secret) return 'shared';
  if (!id || !secret) throw new Error('Configure both PROCORE_PM_DASHBOARD_CLIENT_ID and PROCORE_PM_DASHBOARD_CLIENT_SECRET.');
  if (id === env.PROCORE_CLIENT_ID?.trim()) {
    throw new Error('PM Dashboard must use its own Procore OAuth client, distinct from PROCORE_CLIENT_ID.');
  }
  return 'pm-dashboard';
}

export function currentProcoreConnection(): ProcoreConnection {
  return connectionContext.getStore() || 'shared';
}

export function commitmentMakerProcoreConnection(env: NodeJS.ProcessEnv = process.env): ProcoreConnection {
  // Saving credentials is not activation: install/permission checks must pass
  // before the production switch. This also supports an explicit rollback.
  if (!['true', '1', 'yes'].includes((env.PROCORE_COMMITMENT_MAKER_ENABLED || '').trim().toLowerCase())) return 'shared';
  const id = env.PROCORE_COMMITMENT_MAKER_CLIENT_ID?.trim();
  const secret = env.PROCORE_COMMITMENT_MAKER_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new Error('Configure both PROCORE_COMMITMENT_MAKER_CLIENT_ID and PROCORE_COMMITMENT_MAKER_CLIENT_SECRET.');
  if (id === env.PROCORE_CLIENT_ID?.trim() || id === env.PROCORE_PM_DASHBOARD_CLIENT_ID?.trim()) {
    throw new Error('Commitment Maker must use its own Procore OAuth client, distinct from Analytics and PM Dashboard.');
  }
  return 'commitment-maker';
}

// Selecting a connection does not grant permission to bypass the live API gate.
export function withProcoreConnection<T>(connection: ProcoreConnection, operation: () => T): T {
  return connectionContext.run(connection, operation);
}

export function withPmDashboardProcoreConnection<T>(operation: () => T): T {
  return withProcoreConnection(pmDashboardProcoreConnection(), operation);
}

export function withCommitmentMakerProcoreConnection<T>(operation: () => T): T {
  return withProcoreConnection(commitmentMakerProcoreConnection(), operation);
}

export function procoreServiceCredentials(env: NodeJS.ProcessEnv = process.env) {
  if (currentProcoreConnection() === 'commitment-maker') {
    if (commitmentMakerProcoreConnection(env) !== 'commitment-maker') throw new Error('Commitment Maker Procore credentials are missing.');
    return { clientId: env.PROCORE_COMMITMENT_MAKER_CLIENT_ID!.trim(), clientSecret: env.PROCORE_COMMITMENT_MAKER_CLIENT_SECRET!.trim() };
  }
  if (currentProcoreConnection() === 'pm-dashboard') {
    // Never silently fall back to the shared app after selecting the PM app.
    if (pmDashboardProcoreConnection(env) !== 'pm-dashboard') throw new Error('PM Dashboard Procore credentials are missing.');
    return { clientId: env.PROCORE_PM_DASHBOARD_CLIENT_ID!.trim(), clientSecret: env.PROCORE_PM_DASHBOARD_CLIENT_SECRET!.trim() };
  }
  return { clientId: (env.PROCORE_CLIENT_ID || '').trim(), clientSecret: (env.PROCORE_CLIENT_SECRET || '').trim() };
}

// These identifiers are a fixed allowlist, never request input. Separate tables
// leave the existing app's live leases/quota intact and support rolling deploys.
export function procoreCoordinationTables(connection = currentProcoreConnection()) {
  if (connection === 'commitment-maker') return {
    gates: 'procore_cm_request_gates', controls: 'procore_cm_sync_controls', usage: 'procore_cm_api_usage',
  };
  return connection === 'pm-dashboard'
    ? { gates: 'procore_pm_request_gates', controls: 'procore_pm_sync_controls', usage: 'procore_pm_api_usage' }
    : { gates: 'procore_request_gates', controls: 'procore_sync_controls', usage: 'procore_api_usage' };
}

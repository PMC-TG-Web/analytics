import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as connection from '../src/lib/procoreConnection.ts';
import * as rateLimit from '../src/lib/procoreRateLimit.ts';

const env = { PROCORE_CLIENT_ID: 'shared-client', PROCORE_CLIENT_SECRET: 'shared-secret',
  PROCORE_PM_DASHBOARD_CLIENT_ID: 'pm-client', PROCORE_PM_DASHBOARD_CLIENT_SECRET: 'pm-secret' };
function load(path, dependencies, fetcher = () => assert.fail('Unexpected network request')) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  new Function('require', 'module', 'exports', 'fetch', code)(id => dependencies[id] || {}, module, module.exports, fetcher);
  return module.exports;
}

test('PM connection requires a complete, distinct OAuth client and never silently falls back', async () => {
  assert.equal(connection.pmDashboardProcoreConnection({}), 'shared');
  assert.equal(connection.pmDashboardProcoreConnection(env), 'pm-dashboard');
  assert.throws(() => connection.pmDashboardProcoreConnection({ ...env, PROCORE_PM_DASHBOARD_CLIENT_SECRET: '' }), /both/);
  assert.throws(() => connection.pmDashboardProcoreConnection({ ...env, PROCORE_PM_DASHBOARD_CLIENT_ID: 'shared-client' }), /distinct/);
  await connection.withProcoreConnection('pm-dashboard', async () => {
    assert.equal(connection.procoreServiceCredentials(env).clientId, 'pm-client');
    assert.throws(() => connection.procoreServiceCredentials({}), /missing/);
  });
  assert.equal(connection.currentProcoreConnection(), 'shared');
});

test('concurrent connection contexts remain isolated, including after an exception', async () => {
  await Promise.all(['shared', 'pm-dashboard'].map(profile => connection.withProcoreConnection(profile, async () => {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(connection.currentProcoreConnection(), profile);
    assert.equal(connection.procoreCoordinationTables().gates, profile === 'shared' ? 'procore_request_gates' : 'procore_pm_request_gates');
  })));
  await assert.rejects(connection.withProcoreConnection('pm-dashboard', async () => { throw new Error('test'); }));
  assert.equal(connection.currentProcoreConnection(), 'shared');
});

test('service tokens are cached separately and PM auth failures never use the shared token', async () => {
  const requests = [];
  const client = load('src/lib/procore.ts', {
    'node:async_hooks': { AsyncLocalStorage }, '@/lib/procoreRateLimit': rateLimit,
    '@/lib/procoreConnection': { ...connection, procoreServiceCredentials: () => connection.procoreServiceCredentials(env) },
  }, async (_url, options) => {
    const form = new URLSearchParams(options.body);
    requests.push(form.get('client_id'));
    assert.equal(form.get('client_secret'), form.get('client_id') === 'pm-client' ? 'pm-secret' : 'shared-secret');
    return Response.json({ access_token: `${form.get('client_id')}-token`, expires_in: 3600 });
  });
  assert.equal(await client.getClientCredentialsToken(), 'shared-client-token');
  for (let i = 0; i < 2; i++) {
    assert.equal(await connection.withProcoreConnection('pm-dashboard', () => client.getClientCredentialsToken()), 'pm-client-token');
    assert.equal(await client.getClientCredentialsToken(), 'shared-client-token');
  }
  assert.deepEqual(requests, ['shared-client', 'pm-client']);
  const failing = load('src/lib/procore.ts', {
    'node:async_hooks': { AsyncLocalStorage }, '@/lib/procoreRateLimit': rateLimit,
    '@/lib/procoreConnection': { ...connection, procoreServiceCredentials: () => connection.procoreServiceCredentials(env) },
  }, async () => Response.json({ error: 'invalid_client' }, { status: 401 }));
  await assert.rejects(connection.withProcoreConnection('pm-dashboard', () => failing.getClientCredentialsToken()), /401/);
  await assert.rejects(connection.withProcoreConnection('pm-dashboard', () => client.makeRequest('/rfis', 'test', {}, 'company')), /PROCORE_LIVE_API_DISABLED/);
});

test('a cooldown cached for one connection does not stop the other connection', async () => {
  const queries = [];
  const quota = load('src/lib/procoreQuotaControl.ts', {
    '@/lib/procoreConnection': connection,
    '@/lib/prisma': { prisma: { $queryRawUnsafe: async sql => { queries.push(sql); return []; } } },
  });
  const until = new Date(Date.now() + 60_000);
  quota.cacheProcoreBackgroundCooldown('company', until);
  assert.equal(await quota.getProcoreBackgroundCooldown('company'), until);
  assert.equal(await connection.withProcoreConnection('pm-dashboard', () => quota.getProcoreBackgroundCooldown('company')), null);
  assert.match(queries[0], /procore_pm_sync_controls/);
  connection.withProcoreConnection('pm-dashboard', () => quota.cacheProcoreBackgroundCooldown('other-company', until));
  assert.equal(await quota.getProcoreBackgroundCooldown('other-company'), null);
});

async function runWebhookBatch({ cooldown = null, failPm = false, fullSync = false } = {}) {
  const processed = [], updates = [], leases = [], releases = [];
  const candidates = ['rfis', 'unknown', 'rfis'].map((resourceName, i) => ({ id: `q${i}`, eventId: `e${i}`, attempts: 0, maxAttempts: 5,
    event: { companyId: 'company', projectId: 'project', resourceName, resourceId: `r${i}`, eventType: 'update' },
  }));
  const prisma = {
    syncLog: { findFirst: async () => fullSync ? { id: 'sync' } : null },
    procoreWebhookQueue: {
      findMany: async () => candidates,
      updateMany: async change => { updates.push(change); return { count: 1 }; },
      update: async change => { updates.push(change); return change; },
    },
    procoreWebhookEvent: { update: async () => ({}) },
    $transaction: promises => Promise.all(promises),
  };
  const until = new Date(Date.now() + 60_000);
  const route = load('src/app/api/webhooks/procore/process/route.ts', {
    'node:crypto': { randomUUID }, 'next/server': { NextResponse: Response }, '@/lib/prisma': { prisma },
    '@/lib/procoreConnection': { ...connection, pmDashboardProcoreConnection: () => 'pm-dashboard' },
    '@/lib/procore': { procoreConfig: { companyId: 'company' }, withProcoreLiveApiBypassForSyncSecret: (_req, fn) => fn() },
    '@/lib/procoreWebhookRecovery': { recoverStaleWebhookClaims: async () => ({ recovered: 0, failed: 0 }) },
    '@/lib/procoreQuotaControl': { getProcoreBackgroundCooldown: async () => connection.currentProcoreConnection() === cooldown ? until : null },
    '@/lib/procoreSyncQueue': {
      acquireProcoreWorker: async () => { leases.push(connection.currentProcoreConnection()); return { acquired: true, leaseId: randomUUID() }; },
      releaseProcoreWorker: async () => { releases.push(connection.currentProcoreConnection()); },
    },
    '@/lib/pmDashboardSync': { syncPmDashboardActionItem: async ref => {
      assert.equal(connection.currentProcoreConnection(), 'pm-dashboard');
      if (failPm) throw Object.assign(new Error('rate limited'), { status: 429, rateLimitUntil: until });
      processed.push(ref);
    } },
  });
  const originalSecret = process.env.PROCORE_SYNC_SECRET;
  process.env.PROCORE_SYNC_SECRET = 'test-sync-secret';
  let result;
  try {
    result = await (await route.POST({ headers: new Headers({ 'x-sync-secret': 'test-sync-secret' }),
      nextUrl: new URL('https://test.invalid/process'), json: async () => ({}),
    })).json();
  } finally {
    if (originalSecret === undefined) delete process.env.PROCORE_SYNC_SECRET;
    else process.env.PROCORE_SYNC_SECRET = originalSecret;
  }
  assert.deepEqual(releases.sort(), leases.sort());
  return { result, processed, updates };
}

test('mixed webhook batch processes PM events while the shared app is cooling down', async () => {
  const { result, processed, updates } = await runWebhookBatch({ cooldown: 'shared' });
  assert.equal(processed.length, 2);
  assert.equal(result.claimed, 2);
  assert.equal(result.failed, 0);
  assert.ok(updates.find(update => update.where.id === 'q1' && update.data.availableAt && !update.data.attempts));
});

test('PM webhook throttling returns its attempt and does not park unrelated app events', async () => {
  const { result, updates } = await runWebhookBatch({ failPm: true });
  assert.equal(result.processed, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.claimed, 2);
  assert.ok(updates.find(update => update.where.id === 'q0' && update.data.attempts?.decrement === 1));
  assert.ok(updates.find(update => update.where.id === 'q2' && update.data.availableAt && !update.data.attempts));
});

test('shared full-sync conflicts leave dedicated PM webhook processing available', async () => {
  const { result, processed } = await runWebhookBatch({ fullSync: true });
  assert.equal(processed.length, 2);
  assert.equal(result.claimed, 2);
});

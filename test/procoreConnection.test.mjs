import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import * as connection from '../src/lib/procoreConnection.ts';
import * as rateLimit from '../src/lib/procoreRateLimit.ts';

const env = { PROCORE_COMMITMENT_MAKER_ENABLED: 'true', PROCORE_CLIENT_ID: 'shared-client', PROCORE_CLIENT_SECRET: 'shared-secret',
  PROCORE_PM_DASHBOARD_CLIENT_ID: 'pm-client', PROCORE_PM_DASHBOARD_CLIENT_SECRET: 'pm-secret',
  PROCORE_COMMITMENT_MAKER_CLIENT_ID: 'cm-client', PROCORE_COMMITMENT_MAKER_CLIENT_SECRET: 'cm-secret' };
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
  await Promise.all(['shared', 'pm-dashboard', 'commitment-maker'].map(profile => connection.withProcoreConnection(profile, async () => {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(connection.currentProcoreConnection(), profile);
    assert.equal(connection.procoreCoordinationTables().gates, { shared: 'procore_request_gates', 'pm-dashboard': 'procore_pm_request_gates', 'commitment-maker': 'procore_cm_request_gates' }[profile]);
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
    assert.equal(form.get('client_secret'), { 'shared-client': 'shared-secret', 'pm-client': 'pm-secret', 'cm-client': 'cm-secret' }[form.get('client_id')]);
    return Response.json({ access_token: `${form.get('client_id')}-token`, expires_in: 3600 });
  });
  assert.equal(await client.getClientCredentialsToken(), 'shared-client-token');
  for (let i = 0; i < 2; i++) {
    assert.equal(await connection.withProcoreConnection('pm-dashboard', () => client.getClientCredentialsToken()), 'pm-client-token');
    assert.equal(await connection.withProcoreConnection('commitment-maker', () => client.getClientCredentialsToken()), 'cm-client-token');
    assert.equal(await client.getClientCredentialsToken(), 'shared-client-token');
  }
  assert.deepEqual(requests, ['shared-client', 'pm-client', 'cm-client']);
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
  assert.equal(await connection.withProcoreConnection('commitment-maker', () => quota.getProcoreBackgroundCooldown('company')), null);
  assert.match(queries[1], /procore_cm_sync_controls/);
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


test('Commitment Maker requires a complete client distinct from both other apps', () => {
  assert.equal(connection.commitmentMakerProcoreConnection({}), 'shared');
  assert.equal(connection.commitmentMakerProcoreConnection(env), 'commitment-maker');
  assert.equal(connection.commitmentMakerProcoreConnection({ ...env, PROCORE_COMMITMENT_MAKER_ENABLED: '' }), 'shared');
  assert.throws(() => connection.commitmentMakerProcoreConnection({ PROCORE_COMMITMENT_MAKER_ENABLED: 'true' }), /both/);
  assert.throws(() => connection.commitmentMakerProcoreConnection({ ...env, PROCORE_COMMITMENT_MAKER_CLIENT_SECRET: '' }), /both/);
  for (const clientId of ['shared-client', 'pm-client']) {
    assert.throws(() => connection.commitmentMakerProcoreConnection({ ...env, PROCORE_COMMITMENT_MAKER_CLIENT_ID: clientId }), /distinct/);
  }
  connection.withProcoreConnection('commitment-maker', () => {
    assert.equal(connection.procoreServiceCredentials(env).clientId, 'cm-client');
    assert.throws(() => connection.procoreServiceCredentials({}), /missing/);
  });
});

test('dedicated Commitment Maker authentication never falls back to another app cookie', async () => {
  for (const status of [401, 403, 429, 500]) {
    const failure = Object.assign(new Error('Provider rejected request'), { status });
    const auth = load('src/lib/procoreCommitmentMakerAuth.ts', {
      '@/lib/procoreConnection': connection,
      '@/lib/procore': { getClientCredentialsToken: async () => { throw failure; } },
    });
    await connection.withProcoreConnection('commitment-maker', async () => {
      await assert.rejects(auth.getCommitmentMakerProcoreToken('shared-cookie'), error => error === failure);
    });
    assert.equal((await auth.getCommitmentMakerProcoreToken('shared-cookie')).accessToken, 'shared-cookie');
    await assert.rejects(auth.getCommitmentMakerProcoreToken(''), error => error === failure);
  }
  const route = readFileSync('src/app/api/procore/commitments-live/maker/route.ts', 'utf8');
  assert.match(route, /withCommitmentMakerProcoreConnection\(\(\) => withCommitmentMakerProcoreClient/);
  assert.doesNotMatch(route, /accessToken = cookieToken|getClientCredentialsToken/);
  assert.match(route, /getCommitmentMakerProcoreToken\(cookieToken\)/);
});

test('Commitment Maker background task runner selects its own credentials and request gate context', async () => {
  const observations = [];
  const runner = load('src/lib/procoreCommitmentMakerTaskRunner.ts', {
    '@/lib/procoreConnection': { withCommitmentMakerProcoreConnection: op => connection.withProcoreConnection('commitment-maker', op) },
    '@/lib/procore': {
      getClientCredentialsToken: async () => { observations.push(connection.currentProcoreConnection()); return 'cm-token'; },
      makeRequest: async (_path, token) => { assert.equal(token, 'cm-token'); observations.push(connection.currentProcoreConnection()); return []; },
    },
    '@/lib/prisma': { prisma: { pmcProject: { findUnique: async () => ({ projectName: 'Project' }) }, auditLog: { create: async () => ({}) } } },
    '@/lib/procoreCommitmentMakerTasks': { ensureCommitmentMakerChangeOrderTasks: async ({ request }) => {
      await request({ path: '/rest/v1.0/task_items', method: 'GET' }); return { created: 0 };
    } },
  });
  await runner.runCommitmentMakerChangeOrderTasks({ companyId: 'company', projectId: 'project', changeOrder: { packageId: 'co' }, userEmail: 'test@example.invalid', taskKinds: ['commitment_verification'] });
  assert.deepEqual(observations, ['commitment-maker', 'commitment-maker']);
  assert.equal(connection.currentProcoreConnection(), 'shared');
});

test('Analytics sync requires explicit activation and distinct complete credentials',async()=>{
 const analytics={...env,PROCORE_ANALYTICS_SYNC_ENABLED:'true',PROCORE_ANALYTICS_SYNC_CLIENT_ID:'analytics-client',PROCORE_ANALYTICS_SYNC_CLIENT_SECRET:'analytics-secret'};
 assert.equal(connection.analyticsSyncProcoreConnection({}), 'shared');
 assert.equal(connection.analyticsSyncProcoreConnection(analytics),'analytics-sync');
 assert.throws(()=>connection.analyticsSyncProcoreConnection({...analytics,PROCORE_ANALYTICS_SYNC_CLIENT_SECRET:''}),/both/);
 assert.throws(()=>connection.analyticsSyncProcoreConnection({...analytics,PROCORE_ANALYTICS_SYNC_CLIENT_ID:env.PROCORE_CLIENT_ID}),/distinct/);
 await connection.withProcoreConnection('analytics-sync',async()=>{
  assert.equal(connection.procoreServiceCredentials(analytics).clientId,'analytics-client');
  assert.equal(connection.procoreCoordinationTables().controls,'procore_analytics_sync_controls');
  assert.throws(()=>connection.procoreServiceCredentials(env),/missing/);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(connection.currentProcoreConnection(),'analytics-sync');
 });
 assert.equal(connection.currentProcoreConnection(),'shared');
});
test('authenticated sync selects Analytics but preserves accounting and explicit apps',async()=>{
 const keys=['PROCORE_ANALYTICS_SYNC_ENABLED','PROCORE_ANALYTICS_SYNC_CLIENT_ID','PROCORE_ANALYTICS_SYNC_CLIENT_SECRET'];const saved=keys.map(k=>process.env[k]);
 Object.assign(process.env,{PROCORE_ANALYTICS_SYNC_ENABLED:'true',PROCORE_ANALYTICS_SYNC_CLIENT_ID:'unique-analytics-client',PROCORE_ANALYTICS_SYNC_CLIENT_SECRET:'test-secret'});
 try {
  const request=new Request('http://internal');
  assert.equal(connection.withAuthenticatedSyncConnection(request,()=>connection.currentProcoreConnection()),'analytics-sync');
  assert.equal(connection.withAuthenticatedSyncConnection(new Request('http://internal',{headers:{'x-procore-connection':'shared'}}),()=>connection.currentProcoreConnection()),'shared');
  assert.equal(connection.withProcoreConnection('pm-dashboard',()=>connection.withAuthenticatedSyncConnection(request,()=>connection.currentProcoreConnection())),'pm-dashboard');
  assert.equal(connection.withProcoreConnection('commitment-maker',()=>connection.withAuthenticatedSyncConnection(request,()=>connection.currentProcoreConnection())),'commitment-maker');
 }finally{keys.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i]})}
});
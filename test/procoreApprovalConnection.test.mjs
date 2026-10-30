import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as connection from '../src/lib/procoreConnection.ts';

function fixture({ enabled = true, authorized = true, upstreamError = null } = {}) {
  const requests = [], leases = [], releases = [], finished = [], deferred = [], actions = [];
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync('src/app/api/cron/change-order-approvals/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    'next/server': { NextResponse: Response },
    '@/lib/procoreConnection': { ...connection,
      withAnalyticsSyncProcoreConnection: fn => connection.withProcoreConnection('analytics-sync', fn),
      commitmentMakerProcoreConnection: () => enabled ? 'commitment-maker' : 'shared',
    },
    '@/lib/prisma': { prisma: {
      $executeRawUnsafe: async () => 1,
      $queryRawUnsafe: async () => [{ status: 'In Progress' }],
      syncLog: { create: async () => ({ id: 1n }), update: async () => {} },
      procorePotentialChangeOrder: { findUnique: async () => ({ status: 'Draft' }) },
      procoreChangeOrderPackage: { findUnique: async () => ({ status: 'Draft' }) },
    } },
    '@/lib/procore': {
      hasValidProcoreSyncSecret: () => authorized,
      withProcoreLiveApiBypassForSyncSecret: (_request, fn) => fn(),
      procoreConfig: { companyId: 'company' },
      getClientCredentialsToken: async () => {
        assert.equal(connection.currentProcoreConnection(), 'commitment-maker');
        return 'cm-token';
      },
      getCurrentProcoreRequestMetrics: () => ({ apiRequests: requests.length }),
      makeRequest: async (path, token, options, company) => {
        assert.equal(connection.currentProcoreConnection(), 'commitment-maker');
        assert.equal(token, 'cm-token');
        assert.equal(company, 'company');
        assert.equal(options.method, 'GET');
        requests.push(path);
        if (upstreamError) throw upstreamError;
        return path.includes('/prime_contracts?') ? [{ id: 'contract' }]
          : [{ id: path.includes('/potential_change_orders?') ? 'pco' : 'pcco', status: 'Approved' }];
      },
    },
    '@/lib/procoreSyncQueue': {
      acquireProcoreWorker: async (_company, _minutes, quotaConnection) => {
        leases.push({ owner: connection.currentProcoreConnection(), quotaConnection });
        return { acquired: true, leaseId: 'lease' };
      },
      releaseProcoreWorker: async (_company, lease) => releases.push({ owner: connection.currentProcoreConnection(), lease }),
      seedChangeOrderApprovalQueue: async () => {},
      claimDueProject: async () => ({ companyId: 'company', projectId: 'project', dataset: 'change_order_approvals', leaseId: 'lease' }),
      finishProjectSync: async args => finished.push(args),
      deferProjectSync: async args => deferred.push(args),
      getSyncQueueStats: async () => ({}),
    },
    '@/lib/procoreChangeOrderPackages': { upsertChangeOrderPackage: async () => actions.push('persist-package') },
    '@/lib/procorePotentialChangeOrders': { upsertPotentialChangeOrder: async () => actions.push('persist-potential') },
    '@/lib/procoreCommitmentMakerTasks': {
      commitmentMakerChangeOrderContextFromRecord: value => ({ packageId: value.id }),
      isApprovedChangeOrderStatus: value => value === 'Approved',
    },
    '@/lib/procoreCommitmentMakerTaskQueue': { enqueueCommitmentMakerApprovalTasks: async args => actions.push(args.sourceKind) },
  };
  new Function('require', 'module', 'exports', code)(id => {
    assert.ok(id in dependencies, `Unexpected import ${id}`);
    return dependencies[id];
  }, module, module.exports);
  return { requests, leases, releases, finished, deferred, actions,
    run: () => module.exports.POST(new Request('https://example.test/api/cron/change-order-approvals', { method: 'POST' })),
  };
}

test('approval polling uses Commitment Maker credentials while retaining the Analytics mirror lease and cadence', async () => {
  const f = fixture();
  const result = await (await f.run()).json();
  assert.equal(result.success, true);
  assert.equal(result.connection, 'commitment-maker');
  assert.equal(f.requests.length, 3);
  assert.deepEqual(f.leases, [{ owner: 'analytics-sync', quotaConnection: 'commitment-maker' }]);
  assert.deepEqual(f.releases, [{ owner: 'analytics-sync', lease: 'lease' }]);
  assert.equal(f.finished[0].nextRunMinutes, 90);
  assert.equal(f.finished[0].result.connection, 'commitment-maker');
  assert.deepEqual(f.actions, ['potential_change_order', 'persist-potential', 'change_order_package', 'persist-package']);
});

test('Commitment Maker throttling defers with its original deadline and releases the data lease', async () => {
  const until = new Date(Date.now() + 120_000);
  const f = fixture({ upstreamError: Object.assign(Error('Procore rate limit'), { status: 429, rateLimitUntil: until }) });
  const result = await (await f.run()).json();
  assert.equal(result.deferred, true);
  assert.equal(f.deferred[0].until, until);
  assert.equal(f.finished.length, 0);
  assert.equal(f.requests.length, 1);
  assert.equal(f.actions.length, 0);
  assert.equal(f.releases[0].owner, 'analytics-sync');
});

test('permission failures are failures, never empty successful sweeps or fallback reads', async () => {
  const f = fixture({ upstreamError: Object.assign(Error('Forbidden'), { status: 403 }) });
  assert.equal((await f.run()).status, 502);
  assert.equal(f.finished[0].success, false);
  assert.equal(f.requests.length, 1);
  assert.equal(f.releases.length, 1);
});

test('disabled dedicated credentials and unauthorized requests cannot claim or call Procore', async () => {
  for (const [options, status] of [[{ enabled: false }, 503], [{ authorized: false }, 401]]) {
    const f = fixture(options);
    assert.equal((await f.run()).status, status);
    assert.equal(f.leases.length, 0);
    assert.equal(f.requests.length, 0);
  }
});

test('Commitment Maker cannot share credentials with either background app', () => {
  const env = { PROCORE_COMMITMENT_MAKER_ENABLED: 'true', PROCORE_COMMITMENT_MAKER_CLIENT_ID: 'cm', PROCORE_COMMITMENT_MAKER_CLIENT_SECRET: 'secret' };
  for (const key of ['PROCORE_ANALYTICS_SYNC_CLIENT_ID', 'PROCORE_BILLING_CLIENT_ID']) {
    assert.throws(() => connection.commitmentMakerProcoreConnection({ ...env, [key]: 'cm' }), /distinct/);
  }
});

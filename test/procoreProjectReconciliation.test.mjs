import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as syncResponse from '../src/lib/procoreSyncResponse.ts';

function load(path, dependencies) {
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', source)(id => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`);
    return dependencies[id];
  }, module, module.exports);
  return module.exports;
}

function fixture({ run, worker = { acquired: true, leaseId: 'lease-a' }, failCreate = false } = {}) {
  const updates = [], releases = [], requests = [];
  let creates = 0, connection = false;
  const api = load('src/lib/procoreProjectReconciliation.ts', {
    './prisma': { prisma: { syncLog: {
      create: async ({ data }) => {
        creates++;
        assert.equal(data.triggeredBy, 'project-reconciliation');
        if (failCreate) throw Error('log unavailable');
        return { id: 123n };
      },
      update: async value => { updates.push(value); },
    } } },
    './procoreAllProjectsSync': { runAllProjectsSync: async request => {
      assert.equal(connection, true);
      requests.push({ url: request.url, body: await request.json(), secret: request.headers.get('x-sync-secret') });
      return run ? run(request) : Response.json({ success: true, summary: { errors: [] } });
    } },
    './procoreConnection': { withAnalyticsSyncProcoreConnection: async operation => {
      connection = true;
      try { return await operation(); } finally { connection = false; }
    } },
    './procoreSyncQueue': {
      acquireProcoreWorker: async (_company, minutes) => { assert.equal(connection, true); assert.equal(minutes, 14); return worker; },
      releaseProcoreWorker: async (...values) => { assert.equal(connection, true); releases.push(values); },
    },
    './procoreSyncResponse': syncResponse,
  });
  return { updates, releases, requests, creates: () => creates,
    run: () => api.runProjectReconciliation({ origin: 'https://example.test', secret: 'worker-secret', signal: new AbortController().signal }) };
}

test('a full reconciliation can finish after the former HTTP cutoff and only then records health success', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const f = fixture({ run: async () => {
    assert.equal(f.updates.length, 0);
    now += 90_000;
    return Response.json({ success: true, summary: { errors: [], pmcProjectsSynced: 80 } }, {
      headers: { 'x-procore-api-request-count': '12' },
    });
  } });
  const result = await f.run();
  assert.equal(result.success, true);
  assert.equal(result.totalMs, 90_000);
  assert.equal(result.apiRequests, 12);
  assert.equal(f.updates[0].data.success, true);
  assert.ok(f.updates[0].data.finishedAt instanceof Date);
  assert.equal(f.requests[0].secret, 'worker-secret');
  assert.equal(f.requests[0].body.fetchAll, true);
  assert.equal(f.requests[0].body.forceUserOAuth, false);
  assert.equal(f.requests[0].body.includeInactiveV1, false);
  assert.equal(f.releases.length, 1);
});

for (const [name, run] of [
  ['partial header persistence', async () => Response.json({ success: true, summary: { errors: ['one header failed'] } })],
  ['missing explicit success', async () => Response.json({ summary: { errors: [] } })],
  ['invalid result body', async () => new Response('{')],
  ['HTTP failure', async () => Response.json({ success: true }, { status: 500 })],
  ['deadline or source failure', async () => { throw Error('Deadline exceeded'); }],
]) {
  test(`${name} records a failed attempt and releases the company lease`, async () => {
    const f = fixture({ run });
    assert.equal((await f.run()).success, false);
    assert.equal(f.updates.length, 1);
    assert.equal(f.updates[0].data.success, false);
    assert.ok(f.updates[0].data.finishedAt instanceof Date);
    assert.equal(f.releases.length, 1);
  });
}

test('provider cooldown preserves its deadline for the background retry loop', async () => {
  const until = '2026-10-30T10:00:00.000Z';
  const f = fixture({ run: async () => Response.json({ error: 'Procore API error 429' }, {
    status: 429, headers: { 'x-procore-rate-limit-until': until },
  }) });
  const result = await f.run();
  assert.equal(result.success, false);
  assert.equal(result.rateLimited, true);
  assert.equal(result.rateLimitUntil, until);
});

test('a failed log creation still releases the acquired lease', async () => {
  const f = fixture({ failCreate: true });
  assert.equal((await f.run()).success, false);
  assert.equal(f.requests.length, 0);
  assert.equal(f.releases.length, 1);
});

test('busy or cooling-down companies cannot start or report a successful reconciliation', async () => {
  for (const reason of ['worker_busy', 'rate_limit_cooldown']) {
    const f = fixture({ worker: { acquired: false, reason, control: { rate_limit_until: new Date('2026-10-30T10:00:00Z') } } });
    const result = await f.run();
    assert.equal(result.success, false);
    assert.equal(result.reason, reason);
    assert.equal(f.creates(), 0);
    assert.equal(f.requests.length, 0);
    assert.equal(f.releases.length, 0);
  }
});

test('the cron endpoint distinguishes background acceptance from completed work', async t => {
  const api = load('src/app/api/cron/project-reconciliation/route.ts', {
    'next/server': { NextResponse: Response }, '@/lib/cronSync': { getRequiredSyncSecret: () => 'worker-secret' },
  });
  let status = 202, calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls++;
    assert.equal(url, 'https://example.test/api/background/project-reconciliation');
    assert.equal(init.headers['x-sync-secret'], 'worker-secret');
    return new Response(null, { status });
  });
  const request = new Request('https://example.test/api/cron/project-reconciliation', {
    method: 'POST', headers: { 'x-sync-secret': 'worker-secret' },
  });
  request.nextUrl = new URL(request.url);
  const accepted = await api.POST(request);
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), { success: true, accepted: true, completed: false });
  status = 200;
  assert.equal((await api.POST(request)).status, 502);
  assert.equal((await api.POST(new Request(request.url, { method: 'POST' }))).status, 401);
  assert.equal(calls, 2);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { cachedCommitmentMakerLink, projectLinkPolling } from '../src/lib/procoreProjectLinkPolling.ts';
import { onboardingProgress, ONBOARDING_STEPS, ONBOARDING_STAGE_TIMEOUT_MS } from '../src/lib/procoreOnboardingProgress.ts';
import * as syncResponse from '../src/lib/procoreSyncResponse.ts';
import { procoreLookbackWindow } from '../src/lib/procoreDateWindow.ts';

const now = new Date('2026-10-30T12:00:00Z');
const goodLink = { status: 'unchanged', checkedAt: now.toISOString() };

test('missing documents back off to daily and finding the document resets the wait', () => {
  let prior = {};
  const intervals = [];
  for (let i = 0; i < 10; i++) {
    prior = projectLinkPolling(prior, 'missing_folder');
    intervals.push(prior.nextRunMinutes);
  }
  assert.deepEqual(intervals, [15, 30, 60, 120, 240, 480, 960, 1440, 1440, 1440]);
  assert.equal(projectLinkPolling(prior, 'updated').missingDocumentChecks, 0);
  for (const status of ['missing_file', 'missing_file_url']) {
    assert.equal(projectLinkPolling({ missingDocumentChecks: 2 }, status).nextRunMinutes, 60);
  }
  assert.equal(projectLinkPolling(prior, 'missing_folder', '2026-10-29T13:00:00Z', now).nextRunMinutes, 60);
});

test('completed links retain their verification time, expire daily, and explicit refresh bypasses reuse', () => {
  const cached = cachedCommitmentMakerLink({ commitmentMaker: goodLink }, false, new Date(now.getTime() + 60_000));
  assert.equal(cached.cached, true);
  assert.equal(cached.checkedAt, goodLink.checkedAt);
  assert.equal(cachedCommitmentMakerLink({ commitmentMaker: goodLink }, true, now), null);
  for (const patch of [{ status: 'error' }, { checkedAt: undefined }, { checkedAt: 'invalid' },
    { checkedAt: '2026-10-29T12:00:00Z' }, { checkedAt: '2026-10-31T12:00:00Z' }]) {
    assert.equal(cachedCommitmentMakerLink({ commitmentMaker: { ...goodLink, ...patch } }, false, now), null);
  }
});

const saved = (count) => ({ onboardingProgress: { cycleStartedAt: now.toISOString(), bidBoardIds: ['board-a'],
  steps: ONBOARDING_STEPS.slice(0, count).map(step => ({ step, status: 'ok', httpStatus: 200 })) } });

test('onboarding accepts only a recent, ordered, unfinished successful prefix', () => {
  assert.equal(onboardingProgress(saved(4), now).steps.length, 4);
  for (const patch of [
    { cycleStartedAt: '2026-10-29T12:00:00Z' }, { cycleStartedAt: '2026-10-31T12:00:00Z' },
    { steps: [{ step: ONBOARDING_STEPS[1], status: 'ok' }] },
    { steps: [{ step: ONBOARDING_STEPS[0], status: 'error' }] },
    { bidBoardIds: [] }, { steps: saved(8).onboardingProgress.steps },
  ]) assert.equal(onboardingProgress({ onboardingProgress: { ...saved(4).onboardingProgress, ...patch } }, now).steps.length, 0);
});

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

function onboardingFixture() {
  const project = { companyId: 'company', projectId: 'project', dataset: 'project_onboarding', leaseId: 'lease', lastResult: null };
  const finishes = [], deferrals = [], related = [], requests = [];
  let webhookResult = { success: true, skipped: true, reason: 'no_project_due' };
  const route = load('src/app/api/cron/project-onboarding/route.ts', {
    '@/lib/procoreConnection': { withAnalyticsSyncProcoreConnection: fn => fn() },
    'next/server': { NextResponse: Response },
    '@/lib/cronSync': { getRequiredSyncSecret: () => 'test-secret' },
    '@/lib/procoreDateWindow': { procoreLookbackWindow },
    '@/lib/procoreSyncResponse': syncResponse,
    '@/lib/procoreRateLimit': { procoreQuotaObservation: () => { throw Error('Unexpected quota fallback'); } },
    '@/lib/projectOnboardingPolicy': { shouldParkProjectOnboarding: () => false },
    '@/lib/procore': { withProcoreLiveApiBypassForSyncSecret: (_request, fn) => fn() },
    '@/lib/procoreWebhookMaintenance': { maintainProjectWebhooks: async () => webhookResult },
    '@/lib/procoreOnboardingProgress': { onboardingProgress, ONBOARDING_STEPS, ONBOARDING_STAGE_TIMEOUT_MS },
    '@/lib/prisma': { prisma: {
      syncLog: { create: async () => ({ id: 1n }), update: async () => {} },
      $queryRawUnsafe: async sql => sql.includes('FROM pmc_bid_board_projects')
        ? [{ bid_board_id: 'board-a', procore_project_id: 'project' }] : [{ status: 'Active', has_budget: true }],
      $executeRawUnsafe: async (sql, ...args) => {
        if (sql.includes('last_result = $5::jsonb')) project.lastResult = JSON.parse(args[4]);
        if (sql.includes('INSERT INTO')) related.push(args);
        return 1;
      },
    } },
    '@/lib/procoreSyncQueue': {
      acquireProcoreWorker: async () => ({ acquired: true, leaseId: 'lease' }),
      claimDueProject: async args => { assert.equal(args.retryAfterInterruptedClaim, true); return project; },
      releaseProcoreWorker: async () => {},
      finishProjectSync: async args => { finishes.push(args); project.lastResult = args.result; },
      deferProjectSync: async args => { deferrals.push(args); project.lastResult = args.result; },
      setProcoreRateLimit: async () => { throw Error('Inherited cooldown must not be extended'); },
    },
  });
  return { project, finishes, deferrals, related, requests,
    webhook: value => { webhookResult = value; },
    run: async () => {
      const request = new Request('https://example.test/api/cron/project-onboarding', { method: 'POST', headers: { 'x-sync-secret': 'test-secret' } });
      request.nextUrl = new URL(request.url);
      return (await route.POST(request)).json();
    },
  };
}

test('onboarding resumes a failed budget without replaying headers, estimates, or purchase orders', async t => {
  const f = onboardingFixture();
  let failBudget = true;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    f.requests.push({ url, body: JSON.parse(options.body) });
    if (url.endsWith('/budget-line-items') && failBudget) return Response.json({ error: 'database unavailable' }, { status: 502 });
    return Response.json({ success: true, projectSummaries: [{ proposalCount: 1, lineItemCount: 2 }] });
  });
  for (let i = 0; i < 3; i++) {
    assert.equal((await f.run()).pending, true);
    assert.equal(f.finishes.length, 0);
    assert.equal(f.related.length, 0);
  }
  const cycleStart = f.project.lastResult.onboardingProgress.cycleStartedAt;
  assert.equal((await f.run()).completed, false);
  assert.equal(f.finishes[0].success, false);
  assert.equal(f.project.lastResult.onboardingProgress.steps.length, 3);
  failBudget = false;
  for (let i = 0; i < 5; i++) await f.run();
  assert.equal(f.requests.length, 9);
  assert.equal(f.requests.filter(r => r.url.endsWith('/bid-board-projects')).length, 1);
  assert.equal(f.requests.filter(r => r.url.endsWith('/budget-line-items')).length, 2);
  assert.equal(f.finishes.at(-1).success, true);
  assert.equal(f.project.lastResult.onboardingProgress, undefined);
  assert.equal(f.related.length, 3);
  assert.equal(f.requests.at(-1).body.endDate, procoreLookbackWindow(new Date(cycleStart), 45).endDate);
});

test('onboarding quota deferral keeps the successful prefix and the provider deadline', async t => {
  const f = onboardingFixture();
  f.project.lastResult = saved(3);
  f.project.lastResult.onboardingProgress.cycleStartedAt = new Date().toISOString();
  const until = new Date(Date.now() + 120_000).toISOString();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'rate limited', rateLimited: true, rateLimitUntil: until }, { status: 429 }));
  const result = await f.run();
  assert.equal(result.deferred, true);
  assert.equal(result.completed, false);
  assert.equal(f.deferrals[0].until.toISOString(), until);
  assert.equal(f.project.lastResult.onboardingProgress.steps.length, 3);
  assert.equal(f.related.length, 0);
});

test('webhook registration gets its own invocation and never marks onboarding complete', async t => {
  const f = onboardingFixture();
  f.webhook({ success: true, completed: true });
  t.mock.method(globalThis, 'fetch', async () => { throw Error('Must not start another API stage'); });
  const result = await f.run();
  assert.equal(result.pending, true);
  assert.equal(result.completed, false);
  assert.equal(f.project.lastResult.onboardingProgress.steps.length, 0);
  assert.equal(f.finishes.length, 0);
});

test('webhook maintenance respects its retry/verification schedule even for an explicit onboarding project', async () => {
  let claim;
  const { maintainProjectWebhooks } = load('src/lib/procoreWebhookMaintenance.ts', {
    '@/lib/prisma': { prisma: { pmcProject: { findMany: async () => [] } } },
    '@/lib/procore': {}, '@/lib/procoreProjectWebhooks': {},
    '@/lib/procoreSyncQueue': { claimDueProject: async args => { claim = args; return null; } },
    '@/lib/procorePollingPolicy': {}, '@/lib/projectOnboardingPolicy': {},
  });
  const result = await maintainProjectWebhooks({ companyId: 'company', projectId: 'project', leaseId: 'lease' });
  assert.equal(result.skipped, true);
  assert.equal(claim.projectId, 'project');
  assert.equal(claim.respectDueTime, true);
});

test('document retries reuse the completed link, retain it after failures, and explicit refresh rechecks it', async () => {
  const checkedAt = new Date().toISOString();
  const project = { projectId: 'project', lastResult: { missingDocumentChecks: 2,
    commitmentMaker: { status: 'unchanged', checkedAt } } };
  let linkReads = 0, failDocuments = false;
  const route = load('src/app/api/cron/project-link-sync/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/cronSync': { getRequiredSyncSecret: () => 'test-secret' },
    '@/lib/prisma': { prisma: { $executeRawUnsafe: async () => 1 } },
    '@/lib/procoreProjectLinkPolling': { cachedCommitmentMakerLink, projectLinkPolling },
    '@/lib/procore': {
      getClientCredentialsToken: async () => 'test-token',
      getCurrentProcoreRequestMetrics: () => ({ apiRequests: 1 }),
      withProcoreLiveApiBypassForSyncSecret: (_request, fn) => fn(),
    },
    '@/lib/procoreProjectLinkSync': {
      syncJobScheduleProjectLink: async () => {
        if (failDocuments) throw Error('Document API unavailable');
        return { status: 'missing_folder' };
      },
      syncCommitmentMakerProjectLink: async () => { linkReads++; return { status: 'unchanged' }; },
    },
    '@/lib/procoreSyncQueue': {
      acquireProcoreWorker: async () => ({ acquired: true, leaseId: 'lease' }),
      claimDueProject: async () => project,
      seedPmcProjectSyncQueue: async () => {}, getSyncQueueStats: async () => ({}),
      releaseProcoreWorker: async () => {},
      finishProjectSync: async args => { project.lastResult = args.result; },
    },
  });
  const run = async (explicit = false) => {
    const request = new Request('https://example.test/api/cron/project-link-sync', { method: 'POST',
      headers: { 'x-sync-secret': 'test-secret' }, body: JSON.stringify(explicit ? { projectId: 'project' } : {}) });
    request.nextUrl = new URL(request.url);
    return (await route.POST(request)).json();
  };
  await run();
  assert.equal(linkReads, 0);
  assert.equal(project.lastResult.missingDocumentChecks, 3);
  assert.equal(project.lastResult.nextRunMinutes, 60);
  assert.equal(project.lastResult.commitmentMaker.checkedAt, checkedAt);
  failDocuments = true;
  assert.equal((await run()).success, false);
  assert.equal(project.lastResult.missingDocumentChecks, 3);
  assert.equal(project.lastResult.commitmentMaker.checkedAt, checkedAt);
  failDocuments = false;
  await run(true);
  assert.equal(linkReads, 1);
});

test('queue due-time opt-in preserves ordinary explicit-refresh behavior', async () => {
  const calls = [];
  const { claimDueProject } = load('src/lib/procoreSyncQueue.ts', {
    '@/lib/procoreConnection': {}, 'node:crypto': {}, '@prisma/client': {}, '@/lib/procoreQuotaControl': {},
    '@/lib/prisma': { prisma: { $queryRawUnsafe: async (sql, ...args) => { calls.push({ sql, args }); return []; } } },
  });
  for (const respectDueTime of [undefined, true]) await claimDueProject({
    companyId: 'company', dataset: 'project_webhooks', projectId: 'project', leaseId: 'lease', respectDueTime,
  });
  assert.match(calls[0].sql, /\(\(\$5::text IS NOT NULL AND NOT \$9::boolean\) OR next_run_at <= NOW\(\)\)/);
  assert.equal(calls[0].args[8], false);
  assert.equal(calls[1].args[8], true);
  assert.equal(calls[1].args[4], 'project');
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';
import * as cooldown from '../src/lib/productivityReviewCooldown.ts';

function load(path, imports) {
  const output = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}})(require,module,module.exports)`, {
    module, Date, URL, process: { env: { PROCORE_COMPANY_ID: 'company' } }, console,
    require: (id) => { if (!(id in imports)) throw Error(id); return imports[id]; },
  });
  return module.exports;
}

test('scheduler corrects a creation-anchored date to completion plus 30 days without resending emails', async () => {
  const completedAt = new Date('2026-09-01T12:00:00Z');
  let update;
  let reads = 0;
  const review = {
    id: 'review', projectId: 'project', bidBoardId: 'bid', bidBoardStatus: 'Complete',
    projectNumber: '1', projectName: 'Project', status: 'open',
    cooldownStartedAt: completedAt, reviewEligibleAt: new Date('2026-01-31T12:00:00Z'),
    reminderStatus: 'sent', completionNoticeStatus: 'sent',
  };
  const { POST } = load('src/app/api/cron/productivity-review-reminders/route.ts', {
    'next/server': { NextResponse: { json: (body) => body } },
    resend: { Resend: class {} },
    '@/lib/prisma': { prisma: {
      pmcBidBoardProject: { findMany: async () => [{
        ...review, procoreProjectId: 'project', status: 'Complete',
        payload: { last_status_change: completedAt.toISOString() }, syncedAt: completedAt,
      }] },
      productivityProjectReview: {
        findMany: async () => ++reads === 1 ? [review] : [],
        update: async (args) => { update = args.data; },
      },
    } },
    '@/lib/cronSync': { getRequiredSyncSecret: () => 'secret' },
    '@/lib/productivityReviewCooldown': cooldown,
    '@/lib/productivityReviewEmail': {},
    '@/lib/productivityReviewNotifications': { getProductivityCompleteNotificationConfig: () => ({}) },
    '@/lib/procore': { withProcoreLiveApiBypassForSyncSecret: (_request, fn) => fn() },
    '@/lib/procoreProductivityReviewTask': {},
    '@/lib/productivityOfficeReviewWorker': { processProductivityOfficeReviews: async () => ({ created: 0, failed: 0, scanned: 0 }) },
  });
  const result = await POST({ headers: { get: () => 'secret' }, nextUrl: new URL('https://example.com') });
  assert.equal(result.success, true);
  assert.equal(update.reviewEligibleAt.toISOString(), '2026-10-01T12:00:00.000Z');
  assert.equal(update.reminderStatus, 'not_needed');
  assert.equal(result.completionNoticesSent, 0);
});

test('office worker persists task ID and retries failures while a lost claim creates nothing', async () => {
  for (const mode of ['success', 'failure', 'lost-claim']) {
    let calls = 0;
    const updates = [];
    const { processProductivityOfficeReviews } = load('src/lib/productivityOfficeReviewWorker.ts', {
      '@/lib/prisma': { prisma: { productivityProjectReview: {
        findMany: async (query) => {
          assert.equal(query.where.status, 'completed');
          assert.equal(query.where.notificationEmail, 'todd@pmcdecor.com, david@pmcdecor.com');
          return [{ id: 'review', projectId: 'project', updatedAt: new Date(), completionCount: 1 }];
        },
        updateMany: async (args) => { updates.push(args); return { count: mode === 'lost-claim' ? 0 : 1 }; },
      } } },
      '@/lib/procore': { getClientCredentialsToken: async () => 'token' },
      '@/lib/procoreProductivityReviewTask': { ensureProductivityOfficeReviewTask: async () => {
        calls++;
        if (mode === 'failure') throw Error('Temporary failure');
        return { taskId: 'task-99' };
      } },
    });
    const result = await processProductivityOfficeReviews('company');
    assert.equal(calls, mode === 'lost-claim' ? 0 : 1);
    if (mode === 'success') assert.equal(updates[1].data.notificationId, 'task-99');
    if (mode === 'failure') {
      assert.equal(result.failed, 1);
      assert.equal(updates[1].data.notificationStatus, 'failed');
    }
  }
});

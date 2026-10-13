import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

function workerFixture(source) {
  const deliveries = [];
  const updates = [];
  let apiCalls = 0;
  const candidate = {
    id: 'notification-1', companyId: 'company-1', projectId: 'project-1',
    timesheetId: source.source === 'productivity' ? 'productivity:2026-10-13' : 'sheet-1',
    timecardDate: new Date('2026-10-13'), createdByName: 'Original Lead', attempts: 0,
    maxAttempts: 12, availableAt: new Date(), errorAlertMessage: null,
  };
  const prisma = {
    timecardNotification: {
      updateMany: async () => ({ count: 1 }),
      findMany: async (query) => query.where.errorAlertMessage ? [] : [candidate],
      count: async () => 0,
      update: async (query) => { updates.push(query); },
    },
    pmcProject: { findUnique: async () => ({ projectNumber: '2601', projectName: 'Sample' }) },
  };
  class Resend {
    emails = { send: async (email, options) => {
      deliveries.push({ email, options });
      return { data: { id: 'provider-1' }, error: null };
    } };
  }
  const imports = {
    'next/server': { NextResponse: { json: (body, options) => ({ body, options }) } },
    '@prisma/client': {}, resend: { Resend }, '@/lib/prisma': { prisma },
    '@/lib/cronSync': { getRequiredSyncSecret: () => 'test-secret' },
    '@/lib/dailyLogTimeNotification': { DAILY_LOG_TIME_PREFIX: 'productivity:' },
    '@/lib/timeNotificationSource': { loadTimeNotificationSource: async () => source },
    '@/lib/procore': {
      getClientCredentialsToken: async () => { apiCalls++; return 'test-token'; },
      makeRequest: async () => [], procoreConfig: {},
      withProcoreLiveApiBypassForSyncSecret: async (_request, fn) => fn(),
    },
    '@/lib/timecardNotification': {
      buildTimecardNotificationEmail: (input) => ({ subject: input.source,
        text: JSON.stringify(input), html: 'test' }),
      buildTimecardNotificationErrorEmail: () => { throw new Error('Unexpected alert'); },
      isPmcdecorEmail: (email) => email.endsWith('@pmcdecor.com'),
      selectProjectManagerRecipients: () => [{ email: 'pm@pmcdecor.com' }, { email: 'vendor@example.com' }],
    },
  };
  const code = ts.transpileModule(fs.readFileSync('src/app/api/cron/timecard-notifications/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Date, Map,
    process: { env: { RESEND_API_KEY: 'test-key' } },
    require: (id) => { assert.ok(id in imports, `Unexpected import ${id}`); return imports[id]; },
  });
  const run = () => module.exports.POST({ headers: { get: (key) => key === 'x-sync-secret' ? 'test-secret' : null } });
  return { deliveries, updates, run, apiCalls: () => apiCalls };
}

test('fully deleted timecards are skipped before Procore calls or email delivery', async () => {
  const fixture = workerFixture({ source: 'timecard', entries: [], allDeleted: true, createdByName: null });
  const result = await fixture.run();
  assert.equal(result.body.skipped, 1);
  assert.equal(result.body.sent, 0);
  assert.equal(fixture.deliveries.length, 0);
  assert.equal(fixture.apiCalls(), 0);
  assert.equal(fixture.updates[0].data.status, 'skipped');
  assert.equal(fixture.updates[0].data.errorAlertMessage, null);
});

test('genuinely missing entry lines retry instead of being marked deleted or sent', async () => {
  const fixture = workerFixture({ source: 'timecard', entries: [], allDeleted: false, createdByName: null });
  const result = await fixture.run();
  assert.equal(result.body.retried, 1);
  assert.equal(fixture.deliveries.length, 0);
  assert.equal(fixture.updates[0].data.status, 'pending');
  assert.match(fixture.updates[0].data.lastError, /no synchronized entry lines/);
});

test('daily labor uses the existing PMC recipients, one provider idempotency key and delivery receipt', async () => {
  const fixture = workerFixture({ source: 'productivity', allDeleted: false, createdByName: 'Current Lead',
    entries: [{ partyName: 'Foundation labor', hours: 8 }, { partyName: 'Travel', hours: 1 }],
  });
  const result = await fixture.run();
  assert.equal(result.body.sent, 1);
  assert.equal(fixture.deliveries.length, 1);
  const { email, options } = fixture.deliveries[0];
  assert.equal(Array.from(email.to).join(','), 'pm@pmcdecor.com');
  assert.equal(options.idempotencyKey, 'timecard-company-1-project-1-productivity:2026-10-13');
  const rendered = JSON.parse(email.text);
  assert.equal(rendered.source, 'productivity');
  assert.equal(rendered.entries.length, 2);
  assert.equal(rendered.createdByName, 'Current Lead');
  assert.equal(fixture.updates[0].data.status, 'sent');
  assert.equal(fixture.updates[0].data.providerMessageId, 'provider-1');
});

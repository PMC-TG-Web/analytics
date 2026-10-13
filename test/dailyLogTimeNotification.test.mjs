import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

function load(name, imports = {}, env = {}) {
  const source = fs.readFileSync(`src/lib/${name}.ts`, 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Date, Set, Map,
    process: { env }, require: (id) => {
      assert.ok(id in imports, `Unexpected import ${id}`);
      return imports[id];
    } });
  return module.exports;
}
const policy = load('dailyLogTimeNotification');
const log = {
  id: 'local-1', procoreId: 'log-1', procoreCompanyId: 'company-1', procoreProjectId: 'project-1',
  date: new Date('2026-10-13'), lineItemId: 'line-1', lineItemHolderId: 'po-1',
  lineItemHolderType: 'PurchaseOrderContract', lineItemDescription: 'Labor', quantityUsed: 8,
  procoreDeletedAt: null, procoreCreatedAt: new Date('2026-10-13T14:00:00Z'),
  procoreUpdatedAt: new Date('2026-10-13T14:00:00Z'), createdByName: 'Crew Lead',
};
const item = {
  procoreId: 'line-1', procoreCompanyId: 'company-1', procoreProjectId: 'project-1',
  procorePurchaseOrderContractId: 'po-1', costType: 'Labor', uom: 'hr', description: 'Foundation labor',
};
const select = (logs, items) => policy.selectDailyLogTimeLines(logs, items, 'company-1', 'project-1');

test('only exact hourly Labor quantities count; equipment and lump sums never become hours', () => {
  for (const uom of ['h', 'hr', 'hrs', 'hour', 'hours', ' HR ']) {
    assert.equal(select([log], [{ ...item, uom }])[0].hours, 8);
  }
  for (const changes of [{ uom: 'ls' }, { uom: 'ea' }, { uom: 'cy' }, { uom: null },
    { costType: 'Equipment' }, { costType: 'Materials' }, { costType: 'Subcontractors' }]) {
    assert.equal(select([log], [{ ...item, ...changes }]).length, 0);
  }
});

test('company, project, PO holder and line IDs must match unambiguously', () => {
  for (const changes of [{ procoreCompanyId: 'company-2' }, { procoreProjectId: 'project-2' },
    { procoreId: 'line-2' }, { procorePurchaseOrderContractId: 'po-2' }]) {
    assert.equal(select([log], [{ ...item, ...changes }]).length, 0);
  }
  assert.equal(select([{ ...log, lineItemHolderType: 'WorkOrderContract' }], [item]).length, 0);
  assert.equal(select([{ ...log, procoreCompanyId: 'company-2' }], [item]).length, 0);
  assert.equal(select([log], []).length, 0);
  assert.equal(select([log], [item, item]).length, 0);
});

test('deleted, empty, negative and nonfinite quantities are excluded; distinct labor entries sum once', () => {
  for (const quantityUsed of [0, -1, null, NaN, Infinity]) {
    assert.equal(select([{ ...log, quantityUsed }], [item]).length, 0);
  }
  assert.equal(select([{ ...log, procoreDeletedAt: new Date() }], [item]).length, 0);
  const lines = select([log, log, { ...log, procoreId: 'log-2', quantityUsed: 1.5 }], [item]);
  assert.equal(lines.length, 2);
  assert.equal(lines.reduce((sum, row) => sum + row.hours, 0), 9.5);
});

function storeFixture(logs = [log], items = [item], env = {}) {
  const jobs = new Map();
  const reads = [];
  const prisma = {
    productivityLog: { findMany: async (query) => { reads.push(query); return logs; } },
    purchaseOrderLineItemContractDetail: { findMany: async () => items },
    timecardNotification: { createMany: async ({ data, skipDuplicates }) => {
      assert.equal(skipDuplicates, true);
      const job = data[0];
      const key = `${job.companyId}:${job.projectId}:${job.timesheetId}`;
      if (jobs.has(key)) return { count: 0 };
      jobs.set(key, job);
      return { count: 1 };
    } },
  };
  return { jobs, reads, store: load('dailyLogTimeNotificationStore', {
    './prisma': { prisma }, './dailyLogTimeNotification': policy,
  }, { TIMECARD_NOTIFICATION_NOT_BEFORE: '2026-08-19T00:00:00Z', ...env }) };
}
const payload = { created_at: '2026-10-13T14:00:00Z', log_date: '2026-10-13' };
const params = { companyId: 'company-1', projectId: 'project-1' };

test('multiple entry events and repeated syncs create only one job per project/work date', async () => {
  const { jobs, reads, store } = storeFixture();
  assert.equal(await store.enqueueDailyLogTimeNotifications([payload, payload], params), 1);
  assert.equal(await store.enqueueDailyLogTimeNotifications([payload], params), 0);
  const job = [...jobs.values()][0];
  assert.equal(job.timesheetId, 'productivity:2026-10-13');
  assert.equal(job.timecardDate.toISOString(), '2026-10-13T00:00:00.000Z');
  assert.equal(reads[0].where.procoreCompanyId, 'company-1');
  assert.equal(reads[0].where.procoreProjectId, 'project-1');
  assert.equal(reads[0].where.date.lt.toISOString(), '2026-10-14T00:00:00.000Z');
});

test('activation gate, old work and later edits to historical labor do not send a backlog', async () => {
  const disabled = storeFixture([log], [item], { TIMECARD_NOTIFICATION_NOT_BEFORE: '' });
  assert.equal(await disabled.store.enqueueDailyLogTimeNotifications([payload], params), 0);
  const invalid = storeFixture([log], [item], { PRODUCTIVITY_TIME_NOTIFICATION_NOT_BEFORE: 'invalid' });
  assert.equal(await invalid.store.enqueueDailyLogTimeNotifications([payload], params), 0);
  const old = storeFixture([{ ...log, procoreCreatedAt: new Date('2026-10-12') }]);
  assert.equal(await old.store.enqueueDailyLogTimeNotifications([payload], params), 0);
  const fixture = storeFixture();
  assert.equal(await fixture.store.enqueueDailyLogTimeNotifications([{ ...payload, created_at: '2026-10-12' }], params), 0);
  assert.equal(fixture.reads.length, 0);
});

test('missing PO metadata defers enqueue until a later sync, including an unchanged log', async () => {
  const items = [];
  const fixture = storeFixture([log], items);
  assert.equal(await fixture.store.enqueueDailyLogTimeNotifications([payload], params), 0);
  items.push(item);
  assert.equal(await fixture.store.enqueueDailyLogTimeNotifications([payload], params), 1);
});

test('partially available PO metadata does not send an incomplete daily total', async () => {
  const fixture = storeFixture([log, { ...log, procoreId: 'log-2', lineItemId: 'line-2' }]);
  assert.equal(await fixture.store.enqueueDailyLogTimeNotifications([payload], params), 0);
  const classified = policy.classifyDailyLogTimeLines([log], [{ ...item, uom: null }], 'company-1', 'project-1');
  assert.equal(classified.unresolved, 1);
});

test('source loader keeps timecards and daily productivity separate and distinguishes deleted from missing', async () => {
  let rows = [];
  let dailyReads = 0;
  const source = load('timeNotificationSource', {
    './prisma': { prisma: { $queryRaw: async () => rows } },
    './dailyLogTimeNotification': policy,
    './dailyLogTimeNotificationStore': { loadDailyLogTimeLines: async () => {
      dailyReads++;
      return { lines: [{ description: 'Foundation labor', hours: 8, createdByName: 'Crew Lead' }], allDeleted: false };
    } },
  });
  const candidate = { ...params, timesheetId: 'sheet-1', timecardDate: new Date('2026-10-13') };
  assert.equal((await source.loadTimeNotificationSource(candidate)).allDeleted, false);
  rows = [{ party_name: 'Employee', hours: 8, created_by_name: 'Lead', deleted_at: new Date() }];
  assert.equal((await source.loadTimeNotificationSource(candidate)).allDeleted, true);
  rows.push({ party_name: 'Active', hours: 2, created_by_name: 'Lead', deleted_at: null });
  const active = await source.loadTimeNotificationSource(candidate);
  assert.equal(active.allDeleted, false);
  assert.equal(active.entries.length, 1);
  assert.equal(active.entries[0].hours, 2);
  assert.equal(dailyReads, 0);
  const daily = await source.loadTimeNotificationSource({ ...candidate, timesheetId: 'productivity:2026-10-13' });
  assert.equal(daily.source, 'productivity');
  assert.equal(daily.entries[0].partyName, 'Foundation labor');
  await assert.rejects(source.loadTimeNotificationSource({ ...candidate, timesheetId: 'productivity:2026-10-12' }), /invalid work date/);
});

test('daily email clearly labels labor items, source and snapshot hours without inventing employee names', () => {
  const { buildTimecardNotificationEmail } = load('timecardNotification');
  const email = buildTimecardNotificationEmail({ source: 'productivity', projectName: 'Sample Project',
    projectNumber: '2601', timecardDate: new Date('2026-10-13'), createdByName: 'Crew Lead',
    entries: [{ partyName: '<Foundation labor>', hours: 8 }, { partyName: 'Travel', hours: 1.5 }],
    projectUrl: 'https://example.com/project',
  });
  assert.match(email.subject, /daily log labor/);
  assert.match(email.text, /Labor items:.*Foundation labor/);
  assert.match(email.text, /Total hours: 9.50/);
  assert.match(email.text, /hourly labor only/);
  assert.doesNotMatch(email.text, /Employees:|new timecard/);
  assert.match(email.html, /&lt;Foundation labor&gt;/);
});

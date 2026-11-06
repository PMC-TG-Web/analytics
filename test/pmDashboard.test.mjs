import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isRouteAuthorizedApiRequest } from '../src/lib/permissionRoutes.js';

import {
  buildProcoreItemUrl,
  dateKeyAfter,
  dateKeyInTimeZone,
  isOpenPmItem,
  nextBusinessDateKeys,
  normalizePmActionItem,
} from '../src/lib/pmDashboard.ts';

test('each dashboard item resolves to its exact Procore record', () => {
  assert.equal(
    buildProcoreItemUrl({ sourceType: 'rfi', projectId: 123, sourceId: 81 }),
    'https://us02.procore.com/123/project/rfi/show/81',
  );
  assert.equal(
    buildProcoreItemUrl({ sourceType: 'task', projectId: 123, sourceId: 42 }),
    'https://us02.procore.com/123/project/task_items/42',
  );
  assert.equal(
    buildProcoreItemUrl({ sourceType: 'meeting', projectId: 123, sourceId: 90 }),
    'https://us02.procore.com/123/project/meetings/90',
  );
  assert.equal(
    buildProcoreItemUrl({ sourceType: 'change_event', companyId: 456, projectId: 123, sourceId: 91 }),
    'https://us02.procore.com/webclients/host/companies/456/projects/123/tools/change-events/events/91',
  );
});

test('CE ingestion and saved-card reads use the same current Procore destination', () => {
  const params = { sourceType: 'change_event', companyId: 456, projectId: 123 };
  const legacyUrl = 'https://us02.procore.com/123/project/change_events/91';
  const expected = 'https://us02.procore.com/webclients/host/companies/456/projects/123/tools/change-events/events/91';
  const item = normalizePmActionItem({ ...params, record: { id: 91, title: 'Added footers', status: 'Open', url: legacyUrl } });
  assert.equal(item.sourceUrl, expected);
  assert.equal(buildProcoreItemUrl({ ...params, sourceId: 91, existingUrl: legacyUrl }), expected);
  assert.equal(normalizePmActionItem({ ...params, record: { id: 91 } }).sourceUrl, expected);
});

test('Procore-supplied deep links win while unrelated meeting links are ignored', () => {
  assert.equal(
    buildProcoreItemUrl({
      sourceType: 'rfi',
      projectId: 123,
      sourceId: 81,
      existingUrl: 'https://us02.procore.com/123/project/rfi/show/81?view=compact',
    }),
    'https://us02.procore.com/123/project/rfi/show/81?view=compact',
  );
  assert.equal(
    buildProcoreItemUrl({
      sourceType: 'meeting',
      projectId: 123,
      sourceId: 90,
      existingUrl: 'https://meet.example.com/video-call',
    }),
    'https://us02.procore.com/123/project/meetings/90',
  );
});

test('task normalization resolves assignee IDs through the project directory', () => {
  const item = normalizePmActionItem({
    sourceType: 'task',
    projectId: 123,
    record: {
      id: 42,
      title: 'Confirm anchor layout',
      due_date: '2026-09-03',
      status: 'Initiated',
      assigned_id: 7,
      assignee_ids: [8],
    },
    memberDirectory: new Map([
      ['7', { name: 'Pat Manager', email: 'PAT@PMCDECOR.COM' }],
      ['8', { name: 'Casey Manager', email: 'casey@pmcdecor.com' }],
    ]),
  });

  assert.ok(item);
  assert.deepEqual(item.assigneeEmails, ['pat@pmcdecor.com', 'casey@pmcdecor.com']);
  assert.deepEqual(item.assigneeNames, ['Pat Manager', 'Casey Manager']);
  assert.equal(item.dueAt?.toISOString(), '2026-09-03T12:00:00.000Z');
  assert.equal(item.isOpen, true);
  assert.equal(item.sourceUrl, 'https://us02.procore.com/123/project/task_items/42');
});

test('task calendar deadlines returned as midnight UTC keep their date in My Work', () => {
  for (const dueDate of ['2026-10-28', '2026-10-28T00:00:00Z', '2026-10-28T00:00:00.000Z']) {
    const item = normalizePmActionItem({ sourceType: 'task', record: { id: 42, due_date: dueDate } });
    assert.equal(item.dueAt.toISOString(), '2026-10-28T12:00:00.000Z');
    assert.equal(dateKeyInTimeZone(item.dueAt), '2026-10-28');
  }
});

test('task calendar handling preserves explicit timestamps and meeting times', () => {
  for (const [sourceType, field, timestamp] of [
    ['task', 'due_date', '2026-10-28T17:40:20Z'],
    ['task', 'due_at', '2026-10-28T00:00:00Z'],
    ['meeting', 'starts_at', '2026-10-28T00:00:00Z'],
  ]) {
    const item = normalizePmActionItem({ sourceType, record: { id: 42, [field]: timestamp } });
    assert.equal(item.dueAt.toISOString(), new Date(timestamp).toISOString());
  }
});

test('RFI and meeting normalization use their manager and attendee identities', () => {
  const rfi = normalizePmActionItem({
    sourceType: 'rfi',
    record: {
      id: 81,
      number: 12,
      subject: 'Wall opening dimensions',
      due_date: '2026-09-04',
      status: 'Open',
      rfi_manager: { name: 'Pat Manager', login: 'pat@pmcdecor.com' },
    },
  });
  const meeting = normalizePmActionItem({
    sourceType: 'meeting',
    record: {
      id: 90,
      title: 'OAC Meeting',
      starts_at: '2026-09-04T14:00:00Z',
      ends_at: '2026-09-04T15:00:00Z',
      attendees: [{ name: 'Pat Manager', email: 'pat@pmcdecor.com' }],
    },
  });

  assert.equal(rfi?.number, '12');
  assert.deepEqual(rfi?.assigneeEmails, ['pat@pmcdecor.com']);
  assert.equal(meeting?.dueAt?.toISOString(), '2026-09-04T14:00:00.000Z');
  assert.deepEqual(meeting?.assigneeNames, ['Pat Manager']);
});

test('closed work is excluded while future meetings remain actionable', () => {
  assert.equal(isOpenPmItem('task', { status: 'Closed' }), false);
  assert.equal(isOpenPmItem('rfi', { status: 'Completed' }), false);
  assert.equal(isOpenPmItem('meeting', { status: 'Scheduled' }), true);
  assert.equal(isOpenPmItem('meeting', { is_cancelled: true }), false);
  assert.equal(isOpenPmItem('change_event', { change_event_status: { name: 'Closed' } }), false);
  assert.equal(isOpenPmItem('change_event', { status: 'Pending' }), true);
});

test('CE sync stores structured status labels and the correct open flag', () => {
  for (const [name, mapped_to_status, expectedOpen] of [
    ['Closed', 'closed', false], ['Voided by owner', 'void', false],
    ['Open', 'open', true], ['Pricing in progress', 'pending', true],
  ]) {
    const record = { id: 91, title: 'Added footers', status: { id: 12, name, mapped_to_status } };
    const item = normalizePmActionItem({ sourceType: 'change_event', companyId: 456, projectId: 123, record });
    assert.equal(item.status, name);
    assert.equal(item.isOpen, expectedOpen);
    assert.equal(isOpenPmItem('change_event', record), expectedOpen);
    assert.deepEqual(item.payload, record, 'source evidence stays intact');
  }
  const recycled = normalizePmActionItem({ sourceType: 'change_event', record: { id: 91, status: 'Open', in_recycle_bin: true } });
  assert.equal(recycled.isOpen, false);
});

test('the dashboard produces five stable workday keys across weekends and DST boundaries', () => {
  assert.deepEqual(nextBusinessDateKeys(new Date('2026-10-31T16:00:00Z'), 5), [
    '2026-11-02',
    '2026-11-03',
    '2026-11-04',
    '2026-11-05',
    '2026-11-06',
  ]);
  assert.deepEqual(nextBusinessDateKeys(new Date('2026-09-04T16:00:00Z'), 5), [
    '2026-09-04',
    '2026-09-07',
    '2026-09-08',
    '2026-09-09',
    '2026-09-10',
  ]);
  assert.equal(dateKeyAfter('2026-09-10'), '2026-09-11');
});

test('page, data API, and secret-authenticated sync route are protected', () => {
  const permissions = readFileSync(new URL('../src/lib/permissionRoutes.js', import.meta.url), 'utf8');
  assert.match(permissions, /prefix: '\/pm-dashboard', permission: 'pm-dashboard'/);
  assert.match(permissions, /prefix: '\/api\/pm-dashboard', permission: 'pm-dashboard'/);
  assert.equal(isRouteAuthorizedApiRequest('/api/cron/pm-dashboard', 'POST'), true);
  assert.equal(isRouteAuthorizedApiRequest('/api/cron/pm-dashboard/other', 'POST'), false);
  assert.equal(isRouteAuthorizedApiRequest('/api/cron/pm-dashboard', 'GET'), false);
});

test('the PM dashboard omits the global app navigation for the Procore side panel', () => {
  const appChrome = readFileSync(new URL('../src/components/AppChrome.tsx', import.meta.url), 'utf8');
  assert.match(appChrome, /NAV_HIDDEN_PREFIXES[\s\S]*"\/pm-dashboard"/);
});

test('the PM dashboard uses a verified Procore user session when Auth0 is absent', () => {
  const middleware = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
  const callback = readFileSync(new URL('../src/app/api/auth/procore/callback/route.ts', import.meta.url), 'utf8');
  const requestUser = readFileSync(new URL('../src/lib/requestUser.ts', import.meta.url), 'utf8');

  assert.match(middleware, /verifyProcoreUserSessionCookieValue/);
  assert.match(middleware, /pathname\.startsWith\('\/pm-dashboard\/'\)/);
  assert.match(middleware, /checkDatabasePermission\(request, requiredPermissions\)/);
  assert.match(callback, /\/rest\/v1\.0\/me/);
  assert.match(callback, /createProcoreUserSessionCookieValue/);
  assert.match(requestUser, /PROCORE_USER_SESSION_COOKIE/);
});

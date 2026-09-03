import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildProcoreItemUrl,
  dateKeyAfter,
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
  const middleware = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
  assert.match(permissions, /prefix: '\/pm-dashboard', permission: 'pm-dashboard'/);
  assert.match(permissions, /prefix: '\/api\/pm-dashboard', permission: 'pm-dashboard'/);
  assert.match(middleware, /pathname === '\/api\/cron\/pm-dashboard'/);
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
  assert.match(middleware, /pathname === '\/pm-dashboard'/);
  assert.match(middleware, /checkDatabasePermission\(request, requiredPermissions\)/);
  assert.match(callback, /\/rest\/v1\.0\/me/);
  assert.match(callback, /createProcoreUserSessionCookieValue/);
  assert.match(requestUser, /PROCORE_USER_SESSION_COOKIE/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildProcoreChangeUrl,
  changeEventStatus,
  isOpenPmChange,
} from '../src/lib/pmDashboardChanges.ts';

test('open change status rules exclude terminal change-management records', () => {
  assert.equal(isOpenPmChange('change_event', 'Open'), true);
  assert.equal(isOpenPmChange('change_event', 'Pending'), true);
  assert.equal(isOpenPmChange('change_event', 'Closed'), false);
  assert.equal(isOpenPmChange('pco', 'Draft'), true);
  assert.equal(isOpenPmChange('pco', 'Pending - In Review'), true);
  assert.equal(isOpenPmChange('pco', 'Approved'), false);
  assert.equal(isOpenPmChange('pco', 'not_proceeding'), false);
  assert.equal(isOpenPmChange('pcco', 'Rejected'), false);
  assert.equal(isOpenPmChange('pcco', 'Draft', { deleted_at: '2026-09-01' }), false);
});

test('change-event status falls back to its nested Procore status', () => {
  assert.equal(changeEventStatus({ change_event_status: { name: 'Pending' } }), 'Pending');
  assert.equal(changeEventStatus({ status: 'Open', change_event_status: { name: 'Pending' } }), 'Open');
});

test('change cards resolve to exact Procore records', () => {
  assert.equal(
    buildProcoreChangeUrl({ type: 'change_event', projectId: 123, sourceId: 9 }),
    'https://us02.procore.com/123/project/change_events/9',
  );
  assert.equal(
    buildProcoreChangeUrl({ type: 'pco', projectId: 123, contractId: 55, sourceId: 10 }),
    'https://us02.procore.com/123/project/contracts/55/potential_change_orders/10',
  );
  assert.equal(
    buildProcoreChangeUrl({ type: 'pcco', projectId: 123, contractId: 55, sourceId: 11 }),
    'https://us02.procore.com/123/project/contracts/55/change_order_packages/11',
  );
});

test('changes API reads synchronized mirrors and never calls Procore', () => {
  const route = readFileSync(new URL('../src/app/api/pm-dashboard/changes/route.ts', import.meta.url), 'utf8');
  assert.match(route, /procorePotentialChangeOrder\.findMany/);
  assert.match(route, /procoreChangeOrderPackage\.findMany/);
  assert.match(route, /sourceType: "change_event"/);
  assert.match(route, /assigneeEmails: \{ has: email\.toLowerCase\(\) \}/);
  assert.doesNotMatch(route, /makeRequest|getClientCredentialsToken/);
});

test('five-day work page links to the separate changes view', () => {
  const page = readFileSync(new URL('../src/app/pm-dashboard/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /href="\/pm-dashboard\/changes"/);
});

test('nested dashboard pages and APIs use the verified Procore session flow', () => {
  const middleware = readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
  assert.match(middleware, /pathname\.startsWith\('\/pm-dashboard\/'\)/);
  assert.match(middleware, /pathname\.startsWith\('\/api\/pm-dashboard\/'\)/);
});

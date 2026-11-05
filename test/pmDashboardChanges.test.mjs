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
    buildProcoreChangeUrl({ type: 'change_event', companyId: 456, projectId: 123, sourceId: 9 }),
    'https://us02.procore.com/webclients/host/companies/456/projects/123/tools/change-events/events/9',
  );
  assert.equal(
    buildProcoreChangeUrl({ type: 'pco', companyId: 456, projectId: 123, contractId: 55, sourceId: 10 }),
    'https://us02.procore.com/webclients/host/companies/456/projects/123/tools/contracts/prime_contracts/55/change_orders/prime-change-orders/10',
  );
  assert.equal(
    buildProcoreChangeUrl({ type: 'pcco', companyId: 456, projectId: 123, contractId: 55, sourceId: 11 }),
    'https://us02.procore.com/webclients/host/companies/456/projects/123/tools/contracts/prime_contracts/55/change_orders/prime-change-order-batches/11',
  );
});

test('change-order links require complete identity and retain the configured Procore region', () => {
  for (const type of ['change_event', 'pco', 'pcco']) {
    const identity = { type, companyId: 'company', projectId: 'project', contractId: 'prime', sourceId: 'change' };
    for (const field of ['companyId', 'projectId', 'sourceId', ...(type === 'change_event' ? [] : ['contractId'])]) {
      assert.equal(buildProcoreChangeUrl({ ...identity, [field]: ' ' }), null, `${type}: missing ${field}`);
    }
    assert.equal(new URL(buildProcoreChangeUrl({ ...identity, procoreWebOrigin: 'https://app.procore.com' })).origin, 'https://app.procore.com');
    assert.equal(new URL(buildProcoreChangeUrl({ ...identity, procoreWebOrigin: 'https://procore.com.example.test' })).origin, 'https://us02.procore.com');
  }
});

test('saved legacy CE links cannot override the current company/project/source destination', () => {
  const identity = { type: 'change_event', companyId: 456, projectId: 123, sourceId: 9 };
  const destination = 'https://us02.procore.com/webclients/host/companies/456/projects/123/tools/change-events/events/9';
  for (const existingUrl of [
    'https://us02.procore.com/123/project/change_events/9',
    'https://us02.procore.com/123/project/change_events/events/9',
    destination.replace('/projects/123/', '/projects/999/'),
    destination.replace('/companies/456/', '/companies/999/'),
    destination.replace('/events/9', '/events/99'),
    'https://example.test/change-event/9',
  ]) {
    assert.equal(buildProcoreChangeUrl({ ...identity, existingUrl }), destination);
  }
  assert.equal(buildProcoreChangeUrl({ ...identity, existingUrl: `${destination}?view=details` }), `${destination}?view=details`);
  assert.equal(buildProcoreChangeUrl({ ...identity, companyId: undefined, existingUrl: destination }), null);
  assert.equal(buildProcoreChangeUrl({ ...identity, existingUrl: 'https://app.procore.com/123/project/change_events/9' }), destination.replace('us02.', 'app.'));
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

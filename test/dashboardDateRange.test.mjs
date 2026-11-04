import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  estimatingDashboardSourceDates,
  dashboardProjectDateKey,
  dashboardDateRangeError,
  filterDashboardProjectDates,
} from '../src/lib/estimatingDashboardDates.ts';

test('dashboard dates come from Procore, never local creation, update or sync timestamps', () => {
  const payload = { created_on: '2026-07-06T16:36:58.969514Z', updated_at: '2026-07-30T16:01:42.051924Z' };
  assert.deepEqual(estimatingDashboardSourceDates(payload), {
    dateCreated: '2026-07-06T16:36:58.969Z', dateUpdated: '2026-07-30T16:01:42.051Z',
  });
  assert.deepEqual(estimatingDashboardSourceDates({
    createdAt: '2026-11-04', updatedAt: '2026-11-04', syncedAt: '2026-11-04',
  }), { dateCreated: null, dateUpdated: null });
  const loader = readFileSync(new URL('../src/lib/estimatingDashboard.ts', import.meta.url), 'utf8');
  assert.match(loader, /estimatingDashboardSourceDates\(payload, selected\?\.sourceUpdatedAt\)/);
  assert.doesNotMatch(loader, /date(?:Created|Updated):\s*newestDate/);
});

test('later source estimate edits count, while invalid dates remain missing', () => {
  assert.deepEqual(estimatingDashboardSourceDates(
    { created_on: 'invalid', created_at: '2026-07-01', updated_at: '2026-08-01' },
    new Date('2026-10-03T14:00:00Z'),
  ), { dateCreated: '2026-07-01', dateUpdated: '2026-10-03T14:00:00.000Z' });
  assert.deepEqual(estimatingDashboardSourceDates(null, new Date('invalid')), { dateCreated: null, dateUpdated: null });
  assert.equal(dashboardProjectDateKey({ dateCreated: '2026-10-03', dateUpdated: '2026-09-01' }), '2026-10-03');
  assert.equal(dashboardProjectDateKey({ dateCreated: '2026-10-03', dateUpdated: 'invalid' }), '2026-10-03');
  assert.equal(dashboardProjectDateKey({ dateUpdated: '2026-02-30' }), null);
});

test('inclusive Eastern calendar boundaries do not include the previous day or omit the end day', () => {
  const rows = [
    { id: 'before', dateUpdated: '2026-10-01T03:59:59.999Z' },
    { id: 'start', dateUpdated: '2026-10-01T04:00:00Z' },
    { id: 'end', dateUpdated: '2026-11-01T03:59:59.999Z' },
    { id: 'after', dateUpdated: '2026-11-01T04:00:00Z' },
    { id: 'date-only', dateCreated: '2026-10-31' },
    { id: 'missing' },
  ];
  assert.deepEqual(filterDashboardProjectDates(rows, '2026-10-01', '2026-10-31').map(p => p.id), ['start', 'end', 'date-only']);
  assert.deepEqual(filterDashboardProjectDates(rows, '', '2026-10-31').map(p => p.id), ['before', 'start', 'end', 'date-only']);
  assert.deepEqual(filterDashboardProjectDates(rows, '2026-10-31', '').map(p => p.id), ['end', 'after', 'date-only']);
  assert.equal(filterDashboardProjectDates(rows, '', ''), rows, 'clear includes rows with missing source dates');
});

test('single-day filters cover the full 23-hour and 25-hour daylight-saving days', () => {
  for (const [day, start, end] of [
    ['2026-03-08', '2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z'],
    ['2026-11-01', '2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z'],
  ]) {
    const rows = [-1, 0, Date.parse(end) - Date.parse(start) - 1, Date.parse(end) - Date.parse(start)]
      .map(offset => ({ dateUpdated: new Date(Date.parse(start) + offset).toISOString() }));
    assert.deepEqual(filterDashboardProjectDates(rows, day, day), rows.slice(1, 3));
  }
});

test('bad or inverted ranges produce an explicit validation error', () => {
  for (const [start, end] of [['2026-11-04', '2026-10-01'], ['2026-02-30', ''], ['', 'not-a-date']]) {
    assert.ok(dashboardDateRangeError(start, end));
    assert.throws(() => filterDashboardProjectDates([], start, end));
  }
  assert.equal(dashboardDateRangeError('2028-02-29', '2028-02-29'), null);
  assert.equal(dashboardDateRangeError('', ''), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { captureLegacyPrimaryEstimate } from '../src/lib/procoreLegacyEstimateCapture.ts';

const proposal = { id: 10, type: 'ESTIMATE', is_primary: true, total: 100000, updated_at: '2026-01-02T12:00:00Z' };
const line = (id, quantity, unit = 'HOURS', name = 'Labor') => ({ id, quantity, name, cost_item: { unit } });
function reader({ proposals = [proposal], lines = [line(1, 900), line(2, 100, 'HOURS', 'Project Management'), line(3, 40, 'EA')], confirmed = proposal, repeat = false, malformed = false } = {}) {
  const calls = [];
  const read = async path => {
    calls.push(path);
    assert.match(path, /^\/rest\/v2\.0\/companies\/598134325658789\/estimating\/bid_board_projects\/1\/proposals/);
    if (/\/10$/.test(path)) return { data: confirmed };
    const page = Number(new URL(path, 'https://example.invalid').searchParams.get('page'));
    if (path.includes('/line_items?')) return malformed ? { unexpected: [] } : { data: repeat || page === 1 ? lines : [] };
    return { data: page === 1 ? proposals : [] };
  };
  return { read, calls };
}

test('complete capture includes PM, excludes non-hour quantities and confirms source stability', async () => {
  const { read, calls } = reader();
  const result = await captureLegacyPrimaryEstimate('1', read);
  assert.equal(result.hours, 1000);
  assert.equal(result.sales, 100000);
  assert.equal(result.lineItemCount, 3);
  assert.equal(result.includesProjectManagement, true);
  assert.equal(calls.length, 5);
  assert.ok(calls.some(path => path.endsWith('line_items?page=2&per_page=100')), 'requires terminal empty page');
});

test('all pages contribute to full hours, rather than a ten-line clone preview', async () => {
  const result = await captureLegacyPrimaryEstimate('1', async path => {
    if (/\/10$/.test(path)) return proposal;
    const page = Number(new URL(path, 'https://example.invalid').searchParams.get('page'));
    if (path.includes('/line_items?')) return page <= 3 ? Array.from({ length: page === 3 ? 4 : 100 }, (_, n) => line(page * 1000 + n, 2)) : [];
    return page === 1 ? [proposal] : [];
  });
  assert.equal(result.lineItemCount, 204);
  assert.equal(result.hours, 408);
});

test('missing, conflicting or alternate primary proposals do not become ledger values', async () => {
  for (const proposals of [[], [{ ...proposal, is_primary: false }], [proposal, { ...proposal, id: 11 }], [{ ...proposal, is_procore_bid_form_alternate: true }], [{ ...proposal, type: 'CHANGE_ORDER' }]]) {
    await assert.rejects(captureLegacyPrimaryEstimate('1', reader({ proposals }).read), /uniquely primary/);
  }
});

test('empty, malformed or repeated line pages fail rather than save partial or zero hours', async () => {
  for (const options of [{ lines: [] }, { malformed: true }, { repeat: true }, { lines: [line(1, 'not a number')] }]) {
    await assert.rejects(captureLegacyPrimaryEstimate('1', reader(options).read));
  }
});

test('an estimate edited or no longer primary during the read is rejected', async () => {
  for (const confirmed of [{ ...proposal, updated_at: '2026-01-03' }, { ...proposal, is_primary: false }, { ...proposal, total: 200000 }, { ...proposal, id: 20 }]) {
    await assert.rejects(captureLegacyPrimaryEstimate('1', reader({ confirmed }).read), /changed during capture/);
  }
});

test('non-hour-only estimates can have zero hours; signed hour credits net against labor', async () => {
  assert.equal((await captureLegacyPrimaryEstimate('1', reader({ lines: [line(1, 300, 'EA')] }).read)).hours, 0);
  assert.equal((await captureLegacyPrimaryEstimate('1', reader({ lines: [line(1, 100), line(2, -10)] }).read)).hours, 90);
});

test('arbitrary paths and prefixed IDs cannot change the old-company read target', async () => {
  for (const id of ['../2', '1?company=other', '598134325805519:1', '']) await assert.rejects(captureLegacyPrimaryEstimate(id, async () => { throw new Error('Must not read'); }), /exact old-instance/);
});

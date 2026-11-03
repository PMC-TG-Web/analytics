import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfirmedEstimateOriginals, mergeConfirmedEstimateOriginals, confirmedEstimateOriginalId } from '../src/lib/kpiEstimateOriginals.ts';

const row = { companyId: '1', bidBoardId: '2', proposalId: '3', confirmedAt: '2026-11-03T12:00:00Z', confirmedBy: 'owner@example.test' };
const parse = originals => parseConfirmedEstimateOriginals(JSON.stringify({ version: 1, originals }));

test('confirmed originals require exact source IDs and an audit, with one original per company/bid', () => {
  assert.deepEqual(parseConfirmedEstimateOriginals(null), { version: 1, originals: [] });
  assert.deepEqual(parse([row]).originals, [row]);
  for (const changed of [{ companyId: 1 }, { bidBoardId: '' }, { proposalId: 'name' }, { confirmedAt: 'invalid' }, { confirmedBy: '' }]) {
    assert.throws(() => parse([{ ...row, ...changed }]), /Invalid/);
  }
  assert.throws(() => parse([row, { ...row, proposalId: '4' }]), /Duplicate/);
  assert.throws(() => parseConfirmedEstimateOriginals('{"version":2,"originals":[]}'), /Invalid/);
});

test('confirmations are scoped to company and bid, never to name or proposal alone', () => {
  const originals = parse([row]).originals;
  assert.equal(confirmedEstimateOriginalId(originals, '1', '2'), '3');
  assert.equal(confirmedEstimateOriginalId(originals, '9', '2'), null);
  assert.equal(confirmedEstimateOriginalId(originals, '1', '9'), null);
});

test('saving confirmations is additive and idempotent, preserving prior audit and rejecting replacements', () => {
  const existing = parse([row]);
  const incoming = parse([{ ...row, confirmedAt: '2026-11-04T12:00:00Z' }, { ...row, bidBoardId: '4', proposalId: '5' }]);
  const merged = mergeConfirmedEstimateOriginals(existing, incoming);
  assert.equal(merged.originals.length, 2);
  assert.deepEqual(merged.originals[0], row);
  assert.deepEqual(mergeConfirmedEstimateOriginals(merged, incoming), merged);
  assert.throws(() => mergeConfirmedEstimateOriginals(existing, parse([{ ...row, proposalId: '6' }])), /different confirmed/);
});

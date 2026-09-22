import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCatalogPrice, matchCatalogPrice, catalogSnapshotIssue } from '../src/lib/qboCostCatalog.ts';

const raw = { id: 123, catalog_id: 456, name: "#4 Rebar - 20' Pc", cost_code: '03-200-30-20', type: 'CUSTOM', unit: 'EA', unit_cost: 8.071730000000001 };
const price = () => normalizeCatalogPrice(raw);
const item = () => ({ description: raw.name, costCode: raw.cost_code, uom: 'Each', costType: 'Materials' });
const match = (source = item(), prices = [price()]) => matchCatalogPrice(source, prices, new Map());

test('catalog price normalization keeps current cost and removes floating point noise', () => {
  assert.equal(price().unitCost, '8.07173');
  assert.equal(normalizeCatalogPrice({ ...raw, unit_cost: 0 }).unitCost, null);
  assert.equal(normalizeCatalogPrice({ ...raw, deleted_at: '2026-09-01' }), null);
  assert.equal(normalizeCatalogPrice({ ...raw, unit_cost: -5 }).unitCost, null);
});
test('matches names and units while retaining size and cost-code distinctions', () => {
  for (const name of [raw.name, "CO6 - #4 Rebar - 20' Pc - SOG", "#4 Rebar 20'pc"]) {
    const result = match({ ...item(), description: name });
    assert.equal(result.issue, null); assert.equal(result.unitCost, 8.07173); assert.equal(result.evidence.itemId, '123');
  }
  assert.match(match({ ...item(), description: "#5 Rebar - 20' Pc" }).issue, /no matching/);
  assert.match(match({ ...item(), costCode: '03-200-30-21' }).issue, /no matching/);
  assert.match(match({ ...item(), uom: 'LF' }).issue, /unit/);
});
test('explicit catalog ID wins over edited descriptions but not code/unit mismatches', () => {
  assert.equal(match({ ...item(), description: 'custom description', catalogItemId: '123' }).issue, null);
  assert.match(match({ ...item(), catalogItemId: '999' }).issue, /no matching/);
  assert.match(match({ ...item(), catalogItemId: '123', costCode: '03-200-30-21' }).issue, /different cost code/);
});

test('matches catalog descriptions without confusing rebar sizes, codes, units or ambiguous items', () => {
  const four = { ...price(), description: '#4 Rebar By The Piece' };
  const five = { ...four, itemId: '125', name: "#5 Rebar - 20' Pc", description: '#5 Rebar By The Piece', unitCost: '12.58873' };
  const source = { ...item(), description: 'CO6 - #4 Rebar By The Piece' };
  const result = match(source, [four, five]);
  assert.equal(result.issue, null); assert.equal(result.evidence.itemId, '123'); assert.equal(result.unitCost, 8.07173);
  assert.match(match({ ...source, costCode: '03-200-40-20' }, [four, five]).issue, /no matching/);
  assert.match(match({ ...source, uom: 'LF' }, [four, five]).issue, /unit/);
  assert.match(match(source, [four, { ...five, description: four.description }]).issue, /multiple/);
  assert.match(match(source, [{ ...four, unitCost: null }]).issue, /positive/);
  assert.match(match(source, [{ ...four, type: 'LABOR' }]).issue, /no matching/);
  assert.match(match({ ...source, catalogItemId: '125' }, [four]).issue, /no matching/);
});

test('rebar placement spacing does not change the purchased bar identity', () => {
  for (const spacing of ['12" OCEW', '12" O.C. E.W.', '16" OC']) {
    const r = match({ ...item(), description: `CO6 - #4 Rebar - 20' Pc - ${spacing}` });
    assert.equal(r.issue, null); assert.equal(r.evidence.itemId, '123'); assert.equal(r.unitCost, 8.07173);
  }
  for (const name of ['#5 Rebar - 20\' Pc - 12" OCEW', '#4 Rebar - 10\' Pc - 12" OCEW', '#4 Rebar - 20\' Pc - epoxy coated', '#4 Rebar - 20\' Pc - 12"']) {
    assert.match(match({ ...item(), description: name }).issue, /no matching/);
  }
  assert.match(match({ ...item(), description: 'CO6 - #4 Rebar - 20\' Pc - 12" OCEW', uom: 'LF' }).issue, /unit/);
});
test('ambiguous, missing, or zero catalog prices never fall back to PO prices', () => {
  assert.match(match(item(), [price(), { ...price(), itemId: '124', unitCost: '1' }]).issue, /multiple/);
  assert.match(match(item(), []).issue, /no matching/);
  assert.match(match(item(), [{ ...price(), unitCost: null }]).issue, /positive/);
});
test('catalog snapshot must belong to the company and be complete and current', () => {
  const now = Date.parse('2026-09-21T13:00:00Z');
  const snapshot = { version: 1, companyId: '1', fetchedAt: new Date(now).toISOString(), items: [price()] };
  assert.equal(catalogSnapshotIssue(snapshot, '1', now), null);
  assert.ok(catalogSnapshotIssue(snapshot, '2', now));
  assert.ok(catalogSnapshotIssue({ ...snapshot, items: [] }, '1', now));
  assert.ok(catalogSnapshotIssue(snapshot, '1', now + 86400001));
  assert.ok(catalogSnapshotIssue({ ...snapshot, fetchedAt: 'bad' }, '1', now));
});

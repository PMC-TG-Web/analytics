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
  assert.equal(match({ ...item(), costCode: '03-200-30-21' }).unitCost, 8.07173);
  assert.equal(match({ ...item(), uom: 'LF' }).issue, null);
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
  assert.equal(match({ ...source, costCode: '03-200-40-20' }, [four, five]).unitCost, 8.07173);
  assert.equal(match({ ...source, uom: 'LF' }, [four, five]).issue, null);
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
  assert.equal(match({ ...item(), description: 'CO6 - #4 Rebar - 20\' Pc - 12" OCEW', uom: 'LF' }).issue, null);
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

test('shorthand rebar matches only complete size and purchased length', () => {
  for (const description of ["#4x20' rebar", "CO6 - #4 x 20' Rebar - Site"]) assert.equal(match({ ...item(), description }).unitCost, 8.07173);
  for (const description of ["#5x20' rebar", "#4x10' rebar", "#4x20' rebar epoxy", '#4 rebar']) assert.match(match({ ...item(), description }).issue, /no matching/);
});
test('material singular/plural names match without dropping size or product qualifiers', () => {
  const dowel = { ...price(), itemId: '7', name: '#7 Speed Dowels', description: '#7 Speed Dowels', costCode: '03-150-10-85', unitCost: '2.32' };
  const source = { ...item(), description: '#7 speed dowel', costCode: dowel.costCode };
  const result = match(source, [dowel]);
  assert.equal(result.unitCost, 2.32); assert.equal(result.evidence.itemId, '7');
  for (const description of ['#5 speed dowel', '#7 speed dowel base', '#7 speed dowel tube', '#7 speed dowel epoxy', '#7 speed dowel 9"']) assert.match(match({ ...source, description }, [dowel]).issue, /no matching/);
  assert.equal(match({ ...source, uom: 'lf' }, [dowel]).issue, null);
  assert.match(match(source, [{ ...dowel, type: 'LABOR' }]).issue, /no matching/);
  assert.match(match(source, [{ ...dowel, unitCost: null }]).issue, /positive/);
  assert.match(match(source, [dowel, { ...dowel, itemId: '8', name: '#7 Speed Dowel', unitCost: '4' }]).issue, /multiple/);
  assert.match(match({ ...source, catalogItemId: '999' }, [dowel]).issue, /no matching/);
  assert.equal(match({ ...source, description: 'Chairs 3"' }, [{ ...dowel, name: 'Chair 3"' }]).unitCost, 2.32);
});
test('exact equipment identities share a current price across placement codes without changing source coding', () => {
  const source = { description: 'Somero Power Rake (8 hr minimum) - SOG', costCode: '03-300-00-12', costType: 'Other', uom: 'ea' };
  const sog = { ...price(), name: 'Somero Power Rake (8 hr minimum)', costCode: '03-300-20-30', itemId: '101', unitCost: '600', type: 'SUBCONTRACTOR' };
  const site = { ...sog, costCode: '03-300-30-30', itemId: '102' };
  const result = match(source, [site, sog]);
  for (const suffix of ['-SOG', ' - Site', ' – Wall', ' - Slab On Deck']) assert.equal(match({ ...source, description: 'Somero Power Rake (8 hr minimum)' + suffix }, [sog, site]).unitCost, 600);
  assert.equal(result.issue, null); assert.equal(result.unitCost, 600); assert.equal(result.evidence.itemId, '101'); assert.equal(source.costCode, '03-300-00-12');
  assert.match(match(source, [sog, {...site, unitCost:'650'}]).issue, /different prices/);
  assert.match(match(source, [sog, {...site, unitCost:null}]).issue, /missing prices/);
  assert.equal(match({...source,uom:'hr'}, [sog,site]).issue, null);
  assert.match(match({...source,catalogItemId:'101'}, [sog,site]).issue, /different cost code/);
  assert.match(match({...source,description:'Somero S-840 (8 hr minimum) - SOG'}, [sog,site]).issue, /no matching/);
  assert.match(match({...source,description:'Somero Power Rake (4 hr minimum) - SOG'}, [sog,site]).issue, /no matching/);
});
test('sonotubes match exact Standard Wall Construction dimensions across code and unit labels', () => {
 const source={description:`16"x6' sonotube`,costCode:'03-100-20-20',costType:'Materials',uom:'lf'};
 const tube={...price(),name:`Standard Wall Construction 16" x 6'`,costCode:'03-150-10-85',unitCost:'52.75493'};
 const result=match(source,[tube]);
 assert.equal(result.issue,null); assert.equal(result.unitCost,52.75493);
 assert.ok(match({...source,description:`16"x12' sonotube`},[tube]).issue);
 assert.ok(match({...source,description:`18"x6' sonotube`},[tube]).issue);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseManheimLayer, fetchManheim, manheimFields, manheimFreshness, manheimProjectUrl, manheimId } from '../src/lib/marketManheim.ts';
import { saveLocalResult, saveMarketResults } from '../src/lib/marketStore.ts';

const now = new Date('2026-10-15T16:00:00Z');
const statuses = [{ code: 'A', name: 'Approved' }, { code: 'UR', name: 'Under Review' }, { code: 'UC', name: 'Under Construction' }];
const meta = layer => ({ id: layer, name: ['Pending/Projects Under Review', 'Active/Projects Under Construction'][layer], editingInfo: { lastEditDate: Date.parse('2026-09-01T12:00:00Z') }, fields: manheimFields.map(name => ({ name, ...(name === 'PlanStatus' ? { domain: { codedValues: statuses } } : {}) })) });
const row = { OBJECTID: 8, DatePosted: Date.parse('2026-02-20T12:00:00Z'), PlanStatus: 'A', PlanType: 'Final Plan', Address: 'Example address', ProjectDescription: 'Construct apartment buildings.', DevelopmentType: 'Residential', PlanDrawings: 'https://www.manheimtownship.org/DocumentCenter/View/123/Example', TitleName: 'Example apartments' };
const payload = (...rows) => ({ features: rows.map(attributes => ({ attributes })) });
const parse = (rows = [row], metadata = meta(1), extra = {}) => parseManheimLayer(1, metadata, { ...payload(...rows), ...extra }, { count: rows.length }, now);

test('township status uses explicit field/domain, never the active-layer title or Final Plan type', () => {
  assert.equal(parse().projects[0].status, 'Approved');
  assert.equal(parse([{ ...row, PlanStatus: 'UR' }]).projects[0].status, 'Under review');
  assert.equal(parse([{ ...row, PlanStatus: 'UC' }]).projects[0].status, 'Under construction');
  const p = parse().projects[0];
  assert.equal(p.id, '1:8');
  assert.equal(p.postedAt, '2026-02-20T12:00:00.000Z');
  assert.equal(p.approvedAt, undefined);
  assert.equal(p.permitIssuedAt, undefined);
  assert.notEqual(parseManheimLayer(0, meta(0), payload(row), { count: 1 }, now).projects[0].id, p.id);
});
test('invalid schema, status semantics, identities, dates and incomplete data fail closed', () => {
  for (const extra of [{ error: { code: 500 } }, { exceededTransferLimit: true }, { features: null }]) assert.throws(() => parse([row], meta(1), extra));
  assert.throws(() => parseManheimLayer(1, meta(1), payload(row), { count: 2 }, now));
  assert.throws(() => parse([row], { ...meta(1), fields: [] }));
  const wrongDomain = meta(1); wrongDomain.fields.find(f => f.name === 'PlanStatus').domain.codedValues = [{ code: 'A', name: 'Applied' }];
  assert.throws(() => parse([row], wrongDomain));
  for (const change of [{ OBJECTID: -1 }, { PlanStatus: 'new-code' }, { TitleName: '' }, { DatePosted: NaN }, { DatePosted: Date.parse('2027-01-01') }, { PlanDrawings: 'javascript:alert(1)' }, { PlanDrawings: 'https://evil.example/DocumentCenter/View/1' }]) assert.throws(() => parse([{ ...row, ...change }]));
  assert.throws(() => parse([row, row]));
  assert.deepEqual(parse([]).projects, []);
});
test('malformed source use does not become a project type and missing posted date is explicit', () => {
  const p = parse([{ ...row, DevelopmentType: '3/13/2026', DatePosted: null }]).projects[0];
  assert.equal(p.proposedUse, ''); assert.equal(p.postedAt, null);
});
test('both public layers are required and errors are sanitized; no cross-layer ID collision', async () => {
  const urls = [];
  const result = await fetchManheim(async url => {
    urls.push(url); const layer = url.includes('/0') ? 0 : 1;
    if (url.includes('returnCountOnly')) return { count: 1 };
    if (url.includes('/query?')) return payload(row);
    return meta(layer);
  }, now);
  assert.equal(result.status, 'ok'); assert.equal(result.data.projects.length, 2); assert.equal(urls.length, 6);
  assert.ok(urls.filter(url => url.includes('outFields')).every(url => new URL(url).searchParams.get('outFields') === manheimFields.join(',')));
  const failure = await fetchManheim(async () => { throw Error('Sensitive details'); }, now);
  assert.equal(failure.status, 'error'); assert.equal(failure.data, null); assert.doesNotMatch(failure.message, /Sensitive/);
});
test('fresh checks cannot hide old township publication; source links are bounded', () => {
  const saved = { status: 'ok', data: parse(), checkedAt: now.toISOString(), lastSuccessAt: now.toISOString() };
  assert.equal(manheimFreshness(saved, now), 'Current');
  assert.equal(manheimFreshness({ ...saved, status: 'error' }, now), 'Refresh failed');
  assert.equal(manheimFreshness(saved, new Date('2026-10-18')), 'Refresh overdue');
  assert.equal(manheimFreshness({ ...saved, data: { ...saved.data, sourceUpdatedAt: '2026-01-01' } }, now), 'Township publication overdue');
  assert.throws(() => manheimProjectUrl({ layerId: 2, objectId: 8 }));
  assert.throws(() => manheimProjectUrl({ layerId: 1, objectId: '8 OR 1=1' }));
});
test('township snapshot preserves failed data, replaces successful lists and shares the lease fence', async () => {
  let saved = { data: parse(), lastSuccessAt: now };
  const tx = { marketLocalSnapshot: { findUnique: async ({ where }) => { assert.equal(where.id, manheimId); return saved; }, upsert: async ({ update }) => { saved = { ...saved, ...update }; } }, marketSyncLease: { updateMany: async () => ({ count: 0 }) } };
  await saveLocalResult(tx, manheimId, { status: 'error', data: null, checkedAt: now.toISOString(), message: 'Unavailable' });
  assert.equal(saved.data.projects.length, 1); assert.equal(saved.lastSuccessAt, now);
  await saveLocalResult(tx, manheimId, { status: 'ok', data: { ...parse(), projects: [] }, checkedAt: now.toISOString(), message: null });
  assert.equal(saved.data.projects.length, 0);
  await assert.rejects(() => saveMarketResults([], { $transaction: callback => callback(tx) }, 'expired', undefined, { status: 'ok', data: parse(), checkedAt: now.toISOString() }), /lease expired/);
});

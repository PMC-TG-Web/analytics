import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLancaster, fetchLancaster, lancasterFields, lancasterFreshness, lancasterProjectUrl } from '../src/lib/marketLancaster.ts';
import { saveLancasterResult, saveMarketResults } from '../src/lib/marketStore.ts';

const now = new Date('2026-10-15T16:00:00Z');
const metadata = { id: 0, name: 'SALDO_points', editingInfo: { lastEditDate: Date.parse('2026-09-29T12:00:00Z') }, fields: lancasterFields.map(name => ({ name })) };
const row = { SALDO_Form_ID: '123', SALDO_FileNumber: '26-1', SALDO_MeetingDate: '2026-10-13', SALDO_PlanName: 'Example business expansion', SALDO_ProjectDescription: 'Proposed building addition', SALDO_PlanClassification: 'Final Plan', SALDO_MunicipalityMunicipalities: 'East Lampeter Township|West Lampeter Township', SALDO_ProposedLandUses: 'Commercial|Residential', SALDO_ApplicationClassification: 'Land Development Plan' };
const payload = (...rows) => ({ features: rows.map(attributes => ({ attributes })) });
const parse = (rows = [row], meta = metadata, extra = {}) => parseLancaster(meta, { ...payload(...rows), ...extra }, { count: rows.length }, now);

test('county plans retain submission identity, multiple municipalities, use and meeting date without implying approval', () => {
  const data = parse();
  assert.equal(data.projects[0].id, '123');
  assert.equal(data.projects[0].municipality, 'East Lampeter Township, West Lampeter Township');
  assert.equal(data.projects[0].proposedUse, 'Commercial / Residential');
  assert.equal(data.projects[0].planType, 'Final Plan');
  assert.equal(data.projects[0].meetingDate, '2026-10-13');
  assert.equal(data.projects[0].status, undefined);
  assert.equal(data.projects[0].ownerEmail, undefined);
});

test('county feed fails closed on provider error, truncation, schema drift, missing or malformed records', () => {
  for (const extra of [{ error: { code: 500 } }, { exceededTransferLimit: true }, { features: null }]) assert.throws(() => parse([row], metadata, extra));
  assert.throws(() => parseLancaster(metadata, payload(row), { count: 2 }, now));
  assert.throws(() => parse([row], { ...metadata, name: 'CPO_points' }));
  assert.throws(() => parse([row], { ...metadata, fields: [] }));
  assert.throws(() => parse([row], { ...metadata, editingInfo: { lastEditDate: now.getTime() + 86_400_000 } }));
  for (const change of [{ SALDO_Form_ID: '' }, { SALDO_Form_ID: 'bad' }, { SALDO_MeetingDate: '2026-02-30' }, { SALDO_MeetingDate: '2028-01-01' }, { SALDO_MunicipalityMunicipalities: '' }, { SALDO_PlanName: null }]) assert.throws(() => parse([{ ...row, ...change }]));
});

test('parcel duplicates deduplicate by form ID only and conflicting submissions fail', () => {
  assert.equal(parse([row, row]).projects.length, 1);
  assert.equal(parse([row, { ...row, SALDO_Form_ID: '124' }]).projects.length, 2);
  assert.throws(() => parse([row, { ...row, SALDO_ProjectDescription: 'different' }]));
  assert.deepEqual(parse([]).projects, []);
});

test('county fetch requests only project fields and rejects incomplete response without exposing errors', async () => {
  const urls = [];
  const result = await fetchLancaster(async url => {
    urls.push(new URL(url));
    if (url.includes('returnCountOnly')) return { count: 1 };
    if (url.includes('/query?')) return payload(row);
    return metadata;
  }, now);
  assert.equal(result.status, 'ok');
  assert.equal(urls.length, 3);
  assert.equal(urls.find(url => url.searchParams.has('outFields')).searchParams.get('outFields'), lancasterFields.join(','));
  const failure = await fetchLancaster(async () => { throw new Error('sensitive response'); }, now);
  assert.equal(failure.status, 'error');
  assert.equal(failure.data, null);
  assert.ok(!failure.message.includes('sensitive'));
});

test('source date and meeting date age independently of successful daily checks', () => {
  const saved = { status: 'ok', checkedAt: now.toISOString(), lastSuccessAt: now.toISOString(), data: parse(), message: null };
  assert.equal(lancasterFreshness(saved, now), 'Current');
  assert.equal(lancasterFreshness({ ...saved, status: 'error' }, now), 'Refresh failed');
  assert.equal(lancasterFreshness(saved, new Date('2026-10-18')), 'Refresh overdue');
  assert.equal(lancasterFreshness({ ...saved, data: { ...saved.data, sourceUpdatedAt: '2026-01-01T00:00:00Z' } }, now), 'County publication overdue');
  assert.equal(lancasterFreshness({ ...saved, data: { ...saved.data, projects: [{ ...saved.data.projects[0], meetingDate: '2026-01-01' }] } }, now), 'County publication overdue');
  assert.equal(lancasterFreshness(null, now), 'Awaiting county data');
  assert.throws(() => lancasterProjectUrl("123' OR 1=1"));
  assert.ok(lancasterProjectUrl('123').includes('outFields='));
});

test('snapshot replacement does not retain removed plans, while failure preserves last successful data', async () => {
  const original = parse();
  let saved = { data: original, lastSuccessAt: now };
  const tx = { marketLocalSnapshot: { findUnique: async () => saved, upsert: async ({ update }) => { saved = { ...saved, ...update }; } } };
  await saveLancasterResult(tx, { status: 'error', checkedAt: now.toISOString(), message: 'Unavailable', data: null });
  assert.deepEqual(saved.data, original);
  assert.equal(saved.lastSuccessAt, now);
  await saveLancasterResult(tx, { status: 'ok', checkedAt: now.toISOString(), message: null, data: { ...original, projects: [] } });
  assert.deepEqual(saved.data.projects, []);
  await assert.rejects(() => saveLancasterResult(tx, { status: 'ok', checkedAt: now.toISOString(), data: null }));
});

test('expired worker cannot save county data', async () => {
  let wrote = false;
  const tx = { marketSyncLease: { updateMany: async () => ({ count: 0 }) }, marketLocalSnapshot: { upsert: async () => { wrote = true; } } };
  const db = { $transaction: async callback => callback(tx) };
  await assert.rejects(() => saveMarketResults([], db, 'expired-token', { status: 'ok', checkedAt: now.toISOString(), data: parse() }), /lease expired/);
  assert.equal(wrote, false);
});

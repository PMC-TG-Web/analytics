import test from 'node:test';
import assert from 'node:assert/strict';
import { municipalSources, parseMunicipalHtml, parseCityCoverage, fetchMunicipalFeeds, municipalFreshness, municipalFetchUrl } from '../src/lib/marketMunicipal.ts';
import { saveMarketResults, readMunicipalSnapshots } from '../src/lib/marketStore.ts';

const now = new Date('2026-10-15T18:00:00Z');
const source = id => municipalSources.find(s => s.id === id);
const link = (label, url) => `<a href="${url}">${label}</a>`;
const tableRow = (date, links) => `<tr><td>${date}</td><td>${links}</td></tr>`;
const revize = (heading, rows) => `<h1>${heading}</h1>Planning Commission<table>${rows}</table>`;
const planHtml = 'The following plans/projects are currently under review' + link('Example school', 'https://westhempfield.org/ckfinder/userfiles/files/School.pdf') + '<aside>';
const cityMeta = { id: 0, name: 'SALDO_Approvals', fields: [{ name: 'OBJECTID' }, { name: 'MeetingDate' }], editingInfo: { lastEditDate: Date.parse('2025-11-03') } };
const cityBody = { features: [{ attributes: { OBJECTID: 8, MeetingDate: Date.parse('2023-07-07') } }], exceededTransferLimit: true };
const fixtures = {
  'west-hempfield-plans': planHtml,
  'east-hempfield-records': revize('Planning Commission', tableRow('10/14/26', link('Agenda', 'document_center/PC/October.pdf')) + tableRow('9/9/26', link('Agenda', 'document_center/PC/September.pdf') + link('Minutes', 'document_center/PC/SeptemberMinutes.pdf'))),
  'lancaster-township-records': revize('Agendas &amp; Minutes', tableRow('10/20/26', link('Agenda', 'October Agenda.pdf'))),
  'east-lampeter-records': '<h2 id="planning-commission">Planning Commission</h2><h3>October 13, 2026</h4><h4>Cancelled</h4>' + link('View Agenda', '/wp-content/uploads/2026/Agenda.pdf') + '<hr><h3>August 11, 2026</h4>' + link('View Minutes', '/wp-content/uploads/2026/Minutes.pdf') + '<h2 id="other">Other body</h2>' + link('View Agenda', '/wp-content/uploads/2026/Other.pdf'),
  'west-lampeter-records': '<div id="cat3"><table><tbody>' + tableRow('Posted October 13, 2026', link('Agenda', '/AgendaCenter/ViewFile/Agenda/_10152026-642') + link('', '/AgendaCenter/ViewFile/Minutes/_09172026-635')) + '</tbody></table></div>',
  'manor-records': '<div class="box">Planning Commission Meetings<ul><li>Monday, September 14, 2026' + link('Agenda', '/wp-content/uploads/2026/09/agenda.pdf') + '</li><li>Monday, July 13, 2026' + link('Minutes', '/wp-content/uploads/2026/09/PC-Minutes.pdf') + '</li></ul><div class="box">Other body</div>',
};

test('meeting adapters keep latest agenda/minutes, dates, cancellation and municipal identity', () => {
  const hemp = parseMunicipalHtml(source('east-hempfield-records'), fixtures['east-hempfield-records'], now);
  assert.deepEqual(hemp.documents.map(d => [d.kind, d.meetingDate]), [['Agenda', '2026-10-14'], ['Minutes', '2026-09-09']]);
  assert.equal(hemp.documents[0].url, 'https://www.easthempfield.org/document_center/PC/October.pdf');
  const lanc = parseMunicipalHtml(source('lancaster-township-records'), fixtures['lancaster-township-records'], now);
  assert.equal(lanc.documents[0].url, 'https://www.twp.lancaster.pa.us/October%20Agenda.pdf');
  const east = parseMunicipalHtml(source('east-lampeter-records'), fixtures['east-lampeter-records'], now);
  assert.equal(east.documents.length, 2); assert.equal(east.documents[0].cancelled, true);
  const west = parseMunicipalHtml(source('west-lampeter-records'), fixtures['west-lampeter-records'], now);
  assert.deepEqual(west.documents.map(d => d.meetingDate), ['2026-10-15', '2026-09-17']);
  const manor = parseMunicipalHtml(source('manor-records'), fixtures['manor-records'], now);
  assert.equal(manor.documents[1].meetingDate, '2026-07-13'); // Not the September upload folder.
  assert.ok([hemp, lanc, east, west, manor].every(d => d.plans.length === 0));
  assert.equal(municipalFetchUrl(source('east-lampeter-records'), new Date('2027-01-01')), 'https://eastlampetertownship.org/2027-meeting-archives/');
});

test('undated plan listings cannot become fresh approvals or issued permits', () => {
  const s = source('west-hempfield-plans'), data = parseMunicipalHtml(s, planHtml, now);
  assert.deepEqual(data.plans, [{ name: 'Example school', url: 'https://westhempfield.org/ckfinder/userfiles/files/School.pdf' }]);
  assert.equal(data.latestRecordAt, null); assert.equal(data.sourceUpdatedAt, null);
  assert.equal(data.plans[0].approvedAt, undefined);
  assert.equal(municipalFreshness(s, { data, status: 'ok', lastSuccessAt: now.toISOString() }, now), 'Posting dates unavailable');
});

test('unexpected pages, invalid dates and document links fail closed', () => {
  const s = source('east-hempfield-records');
  for (const html of ['<h1>Sign in</h1>', revize('Planning Commission', ''), revize('Planning Commission', tableRow('2/30/26', link('Agenda', '/a.pdf'))), revize('Planning Commission', tableRow('10/14/26', link('Agenda', 'https://other.example/a.pdf'))), revize('Planning Commission', tableRow('10/14/26', link('Agenda', 'javascript:alert(1)'))), revize('Planning Commission', tableRow('11/1/26', link('Minutes', '/a.pdf'))), revize('Planning Commission', tableRow('12/31/26', link('Agenda', '/a.pdf')))]) assert.throws(() => parseMunicipalHtml(s, html, now));
  assert.throws(() => parseMunicipalHtml(s, revize('Planning Commission', tableRow('10/14/26', link('Agenda', '/a.pdf') + link('Agenda', '/b.pdf'))), now));
  assert.throws(() => parseMunicipalHtml(source('west-hempfield-plans'), 'The following plans/projects are currently under review<aside>', now));
});

test('city coverage exposes stale dates without importing historical projects', () => {
  const data = parseCityCoverage(cityMeta, cityBody, now);
  assert.equal(data.latestRecordAt, '2023-07-07T00:00:00.000Z'); assert.deepEqual(data.plans, []);
  const saved = { data, status: 'ok', lastSuccessAt: now.toISOString() };
  assert.equal(municipalFreshness(source('lancaster-city-records'), saved, now), 'City project feed out of date');
  assert.equal(municipalFreshness(source('lancaster-city-records'), { ...saved, status: 'error' }, now), 'Source check failed');
  assert.equal(municipalFreshness(source('lancaster-city-records'), saved, new Date('2026-10-18')), 'Source check overdue');
  for (const meta of [{ ...cityMeta, fields: [] }, { ...cityMeta, name: 'Something else' }]) assert.throws(() => parseCityCoverage(meta, cityBody, now));
  for (const payload of [{ features: [] }, { error: {} }, { features: [{ attributes: { MeetingDate: NaN } }] }]) assert.throws(() => parseCityCoverage(cityMeta, payload, now));
});

test('one unavailable municipality does not discard other sources; no credentials or PDF contents fetched', async () => {
  const urls = [];
  const results = await fetchMunicipalFeeds(async url => { urls.push(url); return url.includes('/query?') ? cityBody : cityMeta; }, async url => {
    urls.push(url); const s = municipalSources.find(s => municipalFetchUrl(s, now) === url);
    if (s.id === 'manor-records') throw Error('Sensitive details');
    return fixtures[s.id];
  }, now);
  assert.equal(results.length, 7); assert.equal(results.filter(r => r.status === 'ok').length, 6);
  assert.equal(results.find(r => r.id === 'manor-records').data, null);
  assert.doesNotMatch(JSON.stringify(results), /Sensitive details/);
  assert.equal(urls.length, 8); assert.ok(urls.every(url => !url.endsWith('.pdf')));
  assert.equal(new URL(urls.find(url => url.includes('/query?'))).searchParams.get('outFields'), 'OBJECTID,MeetingDate');
});

test('municipal snapshots replace independently, retain failed data and use the market lease fence', async () => {
  const previous = { data: { ...parseCityCoverage(cityMeta, cityBody, now) }, lastSuccessAt: now };
  const rows = new Map([['lancaster-city-records', previous]]);
  const tx = { marketSyncLease: { updateMany: async () => ({ count: 1 }) }, marketLocalSnapshot: { findUnique: async ({ where }) => rows.get(where.id), upsert: async ({ where, update }) => rows.set(where.id, { ...rows.get(where.id), ...update }) } };
  const results = [{ id: 'lancaster-city-records', status: 'error', checkedAt: now.toISOString(), data: null, message: 'Unavailable' }, { id: 'west-hempfield-plans', status: 'ok', checkedAt: now.toISOString(), data: parseMunicipalHtml(source('west-hempfield-plans'), planHtml, now), message: null }];
  await saveMarketResults([], { $transaction: cb => cb(tx) }, 'active', undefined, undefined, results);
  assert.equal(rows.get('lancaster-city-records').data, previous.data);
  assert.equal(rows.get('lancaster-city-records').lastSuccessAt, now);
  assert.equal(rows.get('west-hempfield-plans').data.plans.length, 1);
  tx.marketSyncLease.updateMany = async () => ({ count: 0 });
  await assert.rejects(() => saveMarketResults([], { $transaction: cb => cb(tx) }, 'expired', undefined, undefined, results), /lease expired/);
  const snapshots = await readMunicipalSnapshots({ marketLocalSnapshot: { findMany: async ({ where }) => { assert.equal(where.id.in.length, 7); return [...rows].map(([id, row]) => ({ ...row, id })); } } });
  assert.equal(snapshots.length, 2); assert.equal(snapshots[0].status, 'error');
});

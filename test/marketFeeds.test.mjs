import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseBls, parseFred, parseEia, fetchMarketFeeds, fetchMarketJson } from '../src/lib/marketFeeds.ts';
import { marketSeries, marketChanges, marketFreshness, marketSignal, normalizeMarketPoints, numericValue } from '../src/lib/marketSeries.ts';
import { authorizedMarketSync } from '../src/lib/marketSyncAuth.ts';
import { mergeMarketHistory, saveMarketResults } from '../src/lib/marketStore.ts';

const now = new Date('2026-10-15T16:00:00Z');
const point = (period, value, preliminary = false) => ({ period, value, preliminary });
const ready = marketSeries.find(s => s.id === 'ready-mix');
const snapshot = (points, extra = {}) => ({ id: ready.id, status: 'ok', points, checkedAt: now.toISOString(), lastSuccessAt: now.toISOString(), message: null, ...extra });

test('BLS selects exact series, ignores annual averages and missing values, preserves preliminary flag', () => {
  const payload = { status: 'REQUEST_SUCCEEDED', Results: { series: [{ seriesID: 'WPU1333', data: [
    { year: '2026', period: 'M09', value: '395.319', footnotes: [{ text: 'Preliminary.' }] },
    { year: '2026', period: 'M13', value: '999' }, { year: '2026', period: 'M08', value: '-' },
    { year: '2026', period: 'M07', value: '390' },
  ] }] } };
  assert.deepEqual(parseBls(payload, 'WPU1333', now), [point('2026-07-01', 390), point('2026-09-01', 395.319, true)]);
  assert.throws(() => parseBls(payload, 'wrong', now));
  assert.throws(() => parseBls({ status: 'REQUEST_FAILED' }, 'WPU1333', now));
});

test('normalization rejects invalid/future dates and conflicting duplicate observations', () => {
  assert.deepEqual(normalizeMarketPoints([point('2026-02-30', 4), point('2027-01-01', 5), point('2026-01-01', 0)], now), [point('2026-01-01', 0)]);
  assert.throws(() => normalizeMarketPoints([point('2026-01-01', 4), point('2026-01-01', 5)], now));
  for (const value of ['', ' ', '.', null, false, 'Infinity', '2oops']) assert.equal(numericValue(value), null);
  assert.equal(numericValue('-2.3'), -2.3);
});

test('FRED preserves negative lending balances and ignores missing readings; truncation fails', () => {
  assert.deepEqual(parseFred({ observations: [{ date: '2026-07-01', value: '-5.1' }, { date: '2026-08-01', value: '.' }] }, now), [point('2026-07-01', -5.1)]);
  assert.throws(() => parseFred({ count: 4, observations: [] }, now));
  assert.throws(() => parseFred({ error_code: 400 }, now));
});

test('EIA enforces exact region/series, units, and complete response', () => {
  const series = 'EMD_EPD2D_PTE_R1Y_DPG';
  const row = { period: '2026-10-12', value: '4.123', series, units: '$/GAL' };
  assert.deepEqual(parseEia({ response: { total: '1', data: [row] } }, series, now), [point('2026-10-12', 4.123)]);
  assert.throws(() => parseEia({ response: { data: [{ ...row, series: 'other-region' }] } }, series, now));
  assert.throws(() => parseEia({ response: { total: 2, data: [row] } }, series, now));
  assert.throws(() => parseEia({ response: { data: [{ ...row, units: 'cents' }] } }, series, now));
});

test('comparisons require matching periods, not adjacent surviving observations', () => {
  const changes = marketChanges([point('2025-09-01', 100), point('2026-07-01', 110), point('2026-09-01', 120)], 'monthly');
  assert.equal(changes.previousChange, null);
  assert.ok(Math.abs(changes.annualChange - 20) < 0.0001);
  assert.equal(marketChanges([point('2025-09-01', 0), point('2026-09-01', 1)], 'monthly').annualChange, null);
  assert.ok(marketChanges([point('2025-10-13', 4), point('2026-10-12', 5)], 'weekly').annualChange === 25);
});

test('freshness separates failed refreshes, stale checks, overdue releases, and missing configuration', () => {
  const data = snapshot([point('2026-09-01', 120)]);
  assert.equal(marketFreshness(ready, data, now), 'Current');
  assert.equal(marketFreshness(ready, { ...data, status: 'error' }, now), 'Refresh failed');
  assert.equal(marketFreshness(ready, { ...data, lastSuccessAt: '2026-10-01T00:00:00Z' }, now), 'Refresh overdue');
  assert.equal(marketFreshness(ready, snapshot([point('2026-01-01', 10)]), now), 'Release overdue');
  assert.equal(marketFreshness(ready, snapshot([], { status: 'unconfigured' }), now), 'Setup needed');
});

test('higher costs and higher demand have opposite signals; stale/missing comparisons are neutral', () => {
  const data = snapshot([point('2025-09-01', 100), point('2026-09-01', 110)]);
  assert.equal(marketSignal(ready, data, now), 'weak');
  assert.equal(marketSignal({ ...ready, kind: 'demand' }, data, now), 'strong');
  assert.equal(marketSignal(ready, { ...data, status: 'error' }, now), 'watch');
  assert.equal(marketSignal(ready, snapshot([point('2026-09-01', 100)]), now), 'watch');
  assert.equal(marketSignal({ ...ready, kind: 'context' }, data, now), 'watch');
});

test('history merges source revisions idempotently and retains older periods', () => {
  const prior = [point('2024-01-01', 90), point('2026-09-01', 100, true)];
  const incoming = [point('2026-09-01', 101, false)];
  const result = mergeMarketHistory(prior, incoming);
  assert.deepEqual(result, [prior[0], incoming[0]]);
  assert.deepEqual(mergeMarketHistory(result, incoming), result);
});

test('a failed source keeps its prior observations and successful timestamp', async () => {
  const saved = { points: [point('2026-09-01', 100)], lastSuccessAt: new Date('2026-10-14T12:00:00Z') };
  let update;
  const tx = { marketSeriesSnapshot: { findUnique: async () => saved, upsert: async args => { update = args.update; } } };
  await saveMarketResults([{ id: 'ready-mix', status: 'error', checkedAt: now.toISOString(), message: 'Unavailable', points: [] }], { $transaction: async fn => fn(tx) });
  assert.deepEqual(update.points, saved.points);
  assert.equal(update.lastSuccessAt, saved.lastSuccessAt);
  assert.equal(update.status, 'error');
});

test('an expired worker cannot overwrite observations and successful empty payloads cannot be saved', async () => {
  let writes = 0;
  const tx = { marketSyncLease: { updateMany: async () => ({ count: 0 }) }, marketSeriesSnapshot: { upsert: async () => { writes++; } } };
  const db = { $transaction: async fn => fn(tx) };
  await assert.rejects(() => saveMarketResults([], db, 'expired-token'), /lease expired/);
  await assert.rejects(() => saveMarketResults([{ id: 'ready-mix', status: 'ok', checkedAt: now.toISOString(), message: null, points: [] }], db), /must contain observations/);
  assert.equal(writes, 0);
});

test('batch isolates bad BLS series, never calls keyed feeds without keys', async () => {
  const calls = [];
  const results = await fetchMarketFeeds({ now, env: {}, fetcher: async url => {
    calls.push(url);
    return Response.json({ status: 'REQUEST_SUCCEEDED', Results: { series: [{ seriesID: 'WPU1333', data: [{ year: '2026', period: 'M09', value: '1' }] }] } });
  } });
  assert.equal(calls.length, 3);
  assert.equal(calls.filter(url => url.includes('construction.com')).length, 2);
  assert.equal(results.find(r => r.id === 'dodge-momentum').status, 'error');
  assert.equal(results.find(r => r.id === 'ready-mix').status, 'ok');
  assert.equal(results.find(r => r.id === 'cement').status, 'error');
  assert.equal(results.find(r => r.id === 'diesel').status, 'unconfigured');
  assert.equal(results.find(r => r.id === 'rates').status, 'unconfigured');
});

test('HTTP errors redact secret URLs and respect long Retry-After without early retry', async () => {
  let calls = 0;
  await assert.rejects(() => fetchMarketJson('https://example.test/?key=secret', {}, async () => { calls++; return new Response('', { status: 429, headers: { 'Retry-After': '60' } }); }), error => !error.message.includes('secret'));
  assert.equal(calls, 1);
});

test('cron authentication fails closed and is reached only through an exact middleware exception', () => {
  assert.equal(authorizedMarketSync(null, 'secret'), false);
  assert.equal(authorizedMarketSync('secret', ''), false);
  assert.equal(authorizedMarketSync('wrong', 'secret'), false);
  assert.equal(authorizedMarketSync('secret', 'secret'), true);
  const middleware = fs.readFileSync(new URL('../middleware.ts', import.meta.url), 'utf8');
  assert.ok(middleware.includes("pathname === '/api/cron/market-outlook'"));
  const route = fs.readFileSync(new URL('../src/app/api/cron/market-outlook/route.ts', import.meta.url), 'utf8');
  assert.ok(route.indexOf('if (!authorizedMarketSync') < route.indexOf('await syncMarketOutlook()'));
  assert.ok(route.includes("'Cache-Control': 'no-store'"));
  const page = fs.readFileSync(new URL('../src/app/market-outlook/page.tsx', import.meta.url), 'utf8');
  assert.ok(!page.includes('fetch('));
  assert.ok(page.includes("export const dynamic = 'force-dynamic'"));
});

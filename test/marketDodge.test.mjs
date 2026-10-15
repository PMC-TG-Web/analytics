import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDodgeRelease, parseDodgeReleases, dodgeReleasesUrl } from '../src/lib/marketDodge.ts';
import { fetchMarketFeeds } from '../src/lib/marketFeeds.ts';
import { mergeMarketHistory } from '../src/lib/marketStore.ts';
import { marketChanges, marketSeries } from '../src/lib/marketSeries.ts';

const now = new Date('2026-10-15T16:00:00Z');
const release = (series, content, extra = {}) => ({
  status: 'publish', categories: [series === 'momentum' ? 4 : 5], date_gmt: '2026-10-07T14:00:00',
  link: 'https://www.construction.com/example-release/',
  title: { rendered: series === 'momentum' ? 'Dodge Momentum Index Grows in September' : 'Construction Starts Decline in September' },
  content: { rendered: content }, ...extra,
});
const momentum = (value = 300, previous = 290) => release('momentum', `<p>The Dodge Momentum Index (DMI), issued by <a>Dodge</a>, grew 3% in September to ${value} (2000=100) from the downwardly revised August reading of ${previous}.</p>`);
const starts = (amount = '$500 billion') => release('nonresidential-starts', `<p>Total construction starts fell 2% in September to a seasonally adjusted annual rate of $1.5 trillion.</p><p>Nonresidential building starts fell 2.5% in September to a seasonally adjusted annual rate of ${amount}. For the 12 months ending September, starts rose 17%.</p>`);

test('Dodge DMI reads index level, revised prior month, provenance and HTML spacing', () => {
  const payload = momentum();
  payload.content.rendered = payload.content.rendered.replace('in September', 'in&nbsp;September').replace('to 300', 'to&#160;300');
  const points = parseDodgeRelease(payload, 'momentum', now);
  assert.deepEqual(points.map(p => [p.period, p.value]), [['2026-08-01', 290], ['2026-09-01', 300]]);
  assert.equal(points[1].sourceUrl, payload.link);
  assert.equal(points[1].publishedAt, '2026-10-07T14:00:00Z');
  assert.equal(marketChanges(points, 'monthly').annualChange, null);
});

test('Dodge nonresidential starts excludes total, percentage and rolling-year measures; converts dollar units', () => {
  for (const [amount, expected] of [['$500 billion', 500000], ['$1.25 trillion', 1250000], ['$1,200 billion', 1200000]]) {
    const points = parseDodgeRelease(starts(amount), 'nonresidential-starts', now);
    assert.equal(points.length, 1);
    assert.equal(points[0].value, expected);
    assert.equal(points[0].period, '2026-09-01');
  }
  assert.throws(() => parseDodgeRelease(starts('$500 million'), 'nonresidential-starts', now));
  const wrong = starts();
  wrong.content.rendered = wrong.content.rendered.replace('Nonresidential building', 'Nonbuilding');
  assert.throws(() => parseDodgeRelease(wrong, 'nonresidential-starts', now));
});

test('Dodge reporting months roll over January and cannot come from the publication month', () => {
  const payload = momentum();
  payload.date_gmt = '2026-01-08T14:00:00';
  payload.title.rendered = 'Dodge Momentum Index Grows in December';
  payload.content.rendered = payload.content.rendered.replace('September', 'December').replace('August', 'November');
  assert.deepEqual(parseDodgeRelease(payload, 'momentum', now).map(p => p.period), ['2025-11-01', '2025-12-01']);
  payload.date_gmt = '2025-12-08T14:00:00';
  assert.throws(() => parseDodgeRelease(payload, 'momentum', now), /month mismatch/);
});

test('Dodge rejects wrong identity, unsafe links, future/invalid dates, ambiguous values and mismatched units/months', () => {
  for (const extra of [
    { categories: [5] }, { status: 'draft' }, { link: 'https://example.test/release/' },
    { link: 'https://www.construction.com@evil.test/release/' },
    { date_gmt: '2026-11-07T14:00:00' }, { date_gmt: '2026-02-30T14:00:00' },
    { title: { rendered: 'Dodge Momentum Index Grows in August' } },
  ]) assert.throws(() => parseDodgeRelease({ ...momentum(), ...extra }, 'momentum', now));
  for (const [from, to] of [['2000=100', '2010=100'], ['August reading', 'July reading'], ['300 (', '0 (']]) {
    const payload = momentum();
    payload.content.rendered = payload.content.rendered.replace(from, to);
    assert.throws(() => parseDodgeRelease(payload, 'momentum', now));
  }
  const duplicate = momentum();
  duplicate.content.rendered += duplicate.content.rendered;
  assert.throws(() => parseDodgeRelease(duplicate, 'momentum', now), /ambiguous/);
});

test('Dodge newest release wins revisions regardless of list order and rolling feeds cannot undo saved revisions', () => {
  const older = momentum(295, 280);
  older.date_gmt = '2026-09-08T14:00:00';
  older.title.rendered = older.title.rendered.replace('September', 'August');
  older.content.rendered = older.content.rendered.replace('August', 'July').replace('September', 'August');
  const latest = momentum();
  for (const list of [[older, latest], [latest, older]]) {
    const points = parseDodgeReleases(list, 'momentum', now);
    assert.equal(points.find(p => p.period === '2026-08-01').value, 290);
    const merged = mergeMarketHistory(points, parseDodgeRelease(older, 'momentum', now));
    assert.deepEqual(merged, points);
  }
  assert.throws(() => parseDodgeReleases([momentum(301), latest], 'momentum', now), /Conflicting/);
});

test('Dodge malformed latest releases fail instead of falling back to older observations', () => {
  const bad = momentum();
  bad.content.rendered = '<p>Publisher layout changed; no numeric level.</p>';
  assert.throws(() => parseDodgeReleases([bad, momentum()], 'momentum', now));
  for (const payload of [null, {}, [], Array(7).fill(momentum())]) assert.throws(() => parseDodgeReleases(payload, 'momentum', now));
});

test('Dodge feeds fetch public category windows without credentials and isolate parser failures', async () => {
  const calls = [];
  const results = await fetchMarketFeeds({ now, env: {}, fetcher: async url => {
    calls.push(url);
    if (url === dodgeReleasesUrl('momentum')) return Response.json([momentum()]);
    if (url === dodgeReleasesUrl('nonresidential-starts')) return Response.json([{ ...starts(), content: { rendered: 'Unparseable new release' } }]);
    return Response.json({ status: 'REQUEST_FAILED' });
  } });
  assert.equal(results.length, 16);
  assert.equal(results.find(r => r.id === 'dodge-momentum').status, 'ok');
  assert.equal(results.find(r => r.id === 'dodge-starts').status, 'error');
  assert.deepEqual(results.find(r => r.id === 'dodge-starts').points, []);
  assert.equal(calls.length, 7);
  assert.equal(marketSeries.find(s => s.id === 'dodge-momentum').group, 'Pipeline');
  assert.equal(marketSeries.find(s => s.id === 'dodge-starts').format, 'millions');
});

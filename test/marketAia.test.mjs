import test from 'node:test';
import assert from 'node:assert/strict';
import { aiaIndexUrl, aiaPressUrls, discoverAiaReleases, latestAiaPeriod, parseAiaRelease, fetchAiaReleases } from '../src/lib/marketAia.ts';
import { fetchMarketFeeds, fetchMarketText } from '../src/lib/marketFeeds.ts';
import { marketSeries, marketSignal, formatMarketValue } from '../src/lib/marketSeries.ts';

const now = new Date('2026-10-15T16:00:00Z');
const url = 'https://www.aia.org/about-aia/press/example-abi-release';
const landing = '<a href="/resource-center/abi-august-2026-example">August</a>';
const listing = `<article><a href="${url}"></a><div class="teaser__byline">September 23, 2026</div><p>Architecture Billings Index</p></article>`;
const emptyListing = '<article><p>Other AIA news</p></article>';
function article({ month = 'August', publication = '2026-09-23T08:00:00-0400', dateline = 'September 23, 2026', billings = 49, inquiries = 52, contracts = 48, link = url } = {}) {
  return `<script type="application/ld+json">${JSON.stringify({ '@graph': [{ '@type': 'NewsArticle', publisher: { name: 'The American Institute of Architects' }, datePublished: publication, mainEntityOfPage: link }] })}</script>
    <article class="node node--view-mode-full"><p>WASHINGTON – ${dateline} – The Architecture Billings Index® (ABI) score for ${month} was ${billings}.</p>
    <p>Key ABI highlights for ${month} include:</p><p>Regional averages: Northeast (44.1). Sector index: institutional (45.9).</p>
    <p>Project inquiries index: ${inquiries}</p><p>Design contracts index: ${contracts}</p></article>`;
}

test('AIA extracts labeled national indices with publication date and exact release link', () => {
  const parsed = parseAiaRelease(article().replace('inquiries index:', 'inquiries&nbsp;index:'), url, now);
  assert.equal(parsed.period, '2026-08-01');
  assert.equal(parsed.publishedAt, '2026-09-23T12:00:00.000Z');
  assert.equal(parsed.sourceUrl, url);
  assert.deepEqual(parsed.values, { billings: 49, inquiries: 52, contracts: 48 });
});

test('AIA discovers dated release cards and independently checks latest report month', () => {
  assert.deepEqual(discoverAiaReleases(listing, now), [{ url, publishedDate: '2026-09-23' }]);
  assert.deepEqual(discoverAiaReleases(emptyListing, now), []);
  assert.equal(latestAiaPeriod(landing + '<a href="/resource-center/abi-july-2026-old">July</a>', now), '2026-08-01');
  assert.throws(() => discoverAiaReleases(listing.replace(url, 'https://evil.test/about-aia/press/example'), now));
  assert.throws(() => discoverAiaReleases(listing.replace('September 23', 'February 30'), now));
  assert.throws(() => latestAiaPeriod(landing.replace('2026', '2027'), now));
  assert.throws(() => discoverAiaReleases('<p>Layout changed</p>', now));
});

test('AIA validates publisher, canonical link, dates, ranges, required labels and conflicting values', () => {
  const invalid = [
    article({ link: 'https://evil.test/release' }), article({ inquiries: 101 }), article({ billings: -1 }),
    article({ publication: '2026-11-23T08:00:00-0400', dateline: 'November 23, 2026' }),
    article({ dateline: 'September 24, 2026' }), article({ month: 'October' }),
    article().replace('Design contracts index:', 'Institutional index:'),
    article().replace('The American Institute of Architects', 'Different publisher'),
    article().replace('</article>', '<p>Project inquiries index: 53</p></article>'),
  ];
  for (const html of invalid) assert.throws(() => parseAiaRelease(html, url, now));
  assert.throws(() => parseAiaRelease(article(), 'http://www.aia.org/about-aia/press/example-abi-release', now));
});

test('AIA December reports resolve to prior year, and duplicated matching national values are allowed', () => {
  assert.equal(parseAiaRelease(article({ month: 'December', publication: '2026-01-21T08:00:00-0500', dateline: 'January 21, 2026' }), url, now).period, '2025-12-01');
  const duplicate = article().replace('</article>', '<p>Architecture Billings Index® (ABI) score was 49.</p></article>');
  assert.equal(parseAiaRelease(duplicate, url, now).values.billings, 49);
});

test('AIA shared discovery deduplicates releases and refuses stale fallback when a new report is listed', async () => {
  let calls = 0;
  const request = async target => {
    calls++;
    return target === aiaIndexUrl ? landing : aiaPressUrls.includes(target) ? listing : article();
  };
  const result = await fetchAiaReleases(request, now);
  assert.equal(calls, 5);
  assert.equal(result.contracts[0].value, 48);
  assert.equal(result.billings[0].period, '2026-08-01');
  await assert.rejects(() => fetchAiaReleases(target => target === aiaIndexUrl ? Promise.resolve(landing.replace('august', 'september')) : request(target), now), /Latest AIA release/);
  await assert.rejects(() => fetchAiaReleases(target => target === url ? Promise.resolve('<p>New layout</p>') : request(target), now));
});

test('AIA growth signals use 50, not year-over-year percentage or a 1% neutral band', () => {
  const definition = marketSeries.find(s => s.id === 'aia-billings');
  for (const [value, signal] of [[49.9, 'weak'], [50, 'mixed'], [50.1, 'strong'], [0, 'weak'], [100, 'strong']]) {
    const saved = { id: definition.id, points: [{ period: '2026-08-01', value, preliminary: false }], status: 'ok', lastSuccessAt: now.toISOString() };
    assert.equal(marketSignal(definition, saved, now), signal);
    assert.equal(marketSignal(definition, { ...saved, status: 'error' }, now), 'watch');
  }
  assert.equal(formatMarketValue(definition, 47.2), '47.2');
});

test('AIA batch shares public requests across three feeds and handles non-HTML responses without leaking URLs', async () => {
  const calls = [];
  const results = await fetchMarketFeeds({ now, env: {}, fetcher: async target => {
    calls.push(target);
    if (target.startsWith('https://www.aia.org/')) {
      const body = target === aiaIndexUrl ? landing : aiaPressUrls.includes(target) ? listing : article();
      return new Response(body, { headers: { 'content-type': 'text/html; charset=UTF-8' } });
    }
    return Response.json({ status: 'REQUEST_FAILED' });
  } });
  assert.equal(results.length, 16);
  assert.equal(results.filter(row => row.id.startsWith('aia-') && row.status === 'ok').length, 3);
  assert.equal(calls.filter(target => target.startsWith('https://www.aia.org/')).length, 5);
  await assert.rejects(() => fetchMarketText('https://example.test/?secret=hidden', async () => Response.json({ error: true })), error => !error.message.includes('hidden'));
});

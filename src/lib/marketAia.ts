import { normalizeMarketPoints, type MarketPoint } from './marketSeries.ts';

export const aiaIndexUrl = 'https://www.aia.org/partner-aia/market-research-partnership-opportunities/aia-architecture-billings-index';
export const aiaPressUrls = ['https://www.aia.org/newsroom', 'https://www.aia.org/newsroom?page=1', 'https://www.aia.org/newsroom?page=2'];
export type AiaSeries = 'billings' | 'inquiries' | 'contracts';
type AiaRelease = { period: string; publishedAt: string; sourceUrl: string; values: Record<AiaSeries, number> };
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthPattern = months.join('|');
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};

function text(html: string) {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const value = code.toLowerCase().startsWith('x') ? parseInt(code.slice(1), 16) : Number(code);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ' ';
    }).replace(/&nbsp;/gi, ' ').replace(/&reg;/gi, '®').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}

function sourceUrl(value: string) {
  const url = new URL(value, 'https://www.aia.org');
  if (url.origin !== 'https://www.aia.org' || url.username || url.password || url.search || url.hash || !/^\/about-aia\/press\/[a-z0-9-]+$/.test(url.pathname)) throw new Error('Invalid AIA release URL');
  return url.href;
}

function calendarDate(month: string, day: string, year: string) {
  const index = months.findIndex(name => name.toLowerCase() === month.toLowerCase());
  const date = `${year}-${String(index + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
  if (index < 0 || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Invalid AIA date');
  return date;
}

export function latestAiaPeriod(html: string, now = new Date()) {
  const periods = [...html.matchAll(new RegExp(`href=["'](?:https://www\\.aia\\.org)?/resource-center/abi-(${monthPattern})-(20\\d{2})-[^"']+["']`, 'gi'))]
    .map(match => calendarDate(match[1], '1', match[2])).sort();
  const latest = periods.at(-1);
  if (!latest || Date.parse(latest) > now.getTime()) throw new Error('AIA latest release index invalid');
  return latest;
}

export function discoverAiaReleases(html: string, now = new Date()) {
  const releases = [];
  const articles = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)];
  if (!articles.length) throw new Error('AIA newsroom layout unavailable');
  for (const article of articles) {
    if (!/Architecture Billings Index/i.test(text(article[1]))) continue;
    const link = /<a\b[^>]*href=["']([^"']+)["']/i.exec(article[1]);
    const byline = /<div\b[^>]*class=["'][^"']*\bteaser__byline\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(article[1]);
    const date = byline && new RegExp(`^(${monthPattern}) (\\d{1,2}), (20\\d{2})$`, 'i').exec(text(byline[1]));
    if (!link || !date) throw new Error('AIA release listing invalid');
    const publishedDate = calendarDate(date[1], date[2], date[3]);
    if (Date.parse(publishedDate) > now.getTime()) throw new Error('AIA future release');
    releases.push({ url: sourceUrl(link[1]), publishedDate });
  }
  return releases;
}

function indexValue(body: string, expression: RegExp) {
  const values = [...body.matchAll(expression)].map(match => Number(match[1]));
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0 || value > 100 || value !== values[0])) throw new Error('AIA index missing, conflicting or out of range');
  return values[0];
}

export function parseAiaRelease(html: string, url: string, now = new Date()): AiaRelease {
  const canonical = sourceUrl(url);
  const graphs = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap(match => {
      const data = object(JSON.parse(match[1]));
      return Array.isArray(data['@graph']) ? data['@graph'].map(object) : [data];
    }).filter(row => row['@type'] === 'NewsArticle');
  if (graphs.length !== 1 || graphs[0].mainEntityOfPage !== canonical || object(graphs[0].publisher).name !== 'The American Institute of Architects') throw new Error('AIA release metadata mismatch');
  const rawDate = String(graphs[0].datePublished);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:?\d{2})$/.test(rawDate) || !Number.isFinite(Date.parse(rawDate)) || Date.parse(rawDate) > now.getTime()) throw new Error('AIA publication timestamp invalid');
  const publishedAt = new Date(rawDate).toISOString();
  const article = /<article\b[^>]*class=["'][^"']*\bnode--view-mode-full\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/i.exec(html);
  if (!article) throw new Error('AIA release body missing');
  const body = text(article[1]);
  const dateline = new RegExp(`WASHINGTON [–—-] (${monthPattern}) (\\d{1,2}), (20\\d{2})`, 'i').exec(body);
  if (!dateline || calendarDate(dateline[1], dateline[2], dateline[3]) !== rawDate.slice(0, 10)) throw new Error('AIA dateline mismatch');
  const highlights = [...body.matchAll(new RegExp(`Key ABI highlights for (${monthPattern}) include:`, 'gi'))];
  if (highlights.length !== 1) throw new Error('AIA reporting month missing or ambiguous');
  const reportMonth = months.findIndex(month => month.toLowerCase() === highlights[0][1].toLowerCase());
  const publicationMonth = Number(rawDate.slice(5, 7)) - 1;
  const year = Number(rawDate.slice(0, 4)) - (reportMonth >= publicationMonth ? 1 : 0);
  const period = calendarDate(highlights[0][1], '1', String(year));
  if ((Date.parse(publishedAt) - Date.parse(period)) / 86_400_000 > 100) throw new Error('AIA reporting period mismatch');
  const billings = indexValue(body, new RegExp(`Architecture Billings Index\\s*®?\\s*\\(ABI\\) score(?: for (?:the month|${monthPattern}))? (?:of|was|is) (\\d+(?:\\.\\d+)?)\\b`, 'gi'));
  // Only labeled national indices in the highlights block, never regional/sector averages.
  const national = body.slice(highlights[0].index!);
  const inquiries = indexValue(national, /Project inquiries index:\s*(\d+(?:\.\d+)?)\b/gi);
  const contracts = indexValue(national, /Design contracts index:\s*(\d+(?:\.\d+)?)\b/gi);
  return { period, publishedAt, sourceUrl: canonical, values: { billings, inquiries, contracts } };
}

/** Bounded public newsroom discovery; the ABI landing page guards against quietly missing a new release. */
export async function fetchAiaReleases(request: (url: string) => Promise<string>, now = new Date()): Promise<Record<AiaSeries, MarketPoint[]>> {
  const [index, ...newsrooms] = await Promise.all([aiaIndexUrl, ...aiaPressUrls].map(request));
  const expectedPeriod = latestAiaPeriod(index, now);
  const unique = new Map(newsrooms.flatMap(html => discoverAiaReleases(html, now)).map(row => [row.url, row]));
  const candidates = [...unique.values()].sort((a, b) => b.publishedDate.localeCompare(a.publishedDate)).slice(0, 3);
  if (!candidates.length) throw new Error('AIA release not found');
  const releases = await Promise.all(candidates.map(async candidate => {
    const release = parseAiaRelease(await request(candidate.url), candidate.url, now);
    if (release.publishedAt.slice(0, 10) !== candidate.publishedDate) throw new Error('AIA listed publication mismatch');
    return release;
  }));
  if (releases[0].period < expectedPeriod) throw new Error('Latest AIA release not yet readable');
  const result = { billings: [], inquiries: [], contracts: [] } as Record<AiaSeries, MarketPoint[]>;
  for (const series of ['billings', 'inquiries', 'contracts'] as const) {
    const points = new Map<string, MarketPoint>();
    for (const release of releases) {
      const point = { period: release.period, value: release.values[series], publishedAt: release.publishedAt, sourceUrl: release.sourceUrl, preliminary: false };
      const previous = points.get(point.period);
      if (previous?.publishedAt === point.publishedAt && previous.value !== point.value) throw new Error('Conflicting AIA releases');
      if (!previous || point.publishedAt > previous.publishedAt!) points.set(point.period, point);
    }
    result[series] = normalizeMarketPoints([...points.values()], now);
  }
  return result;
}

import { normalizeMarketPoints, type MarketPoint } from './marketSeries.ts';

export type DodgeSeries = 'momentum' | 'nonresidential-starts';
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthPattern = months.join('|');
const numberPattern = '(\\d+(?:,\\d{3})*(?:\\.\\d+)?)';
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};

// Only extract text for numeric validation. Publisher HTML is never rendered in the app.
function plainText(value: unknown): string {
  if (typeof value !== 'string' || value.length > 500_000) throw new Error('Invalid Dodge content');
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code: string) => {
      const value = code.toLowerCase().startsWith('x') ? parseInt(code.slice(1), 16) : Number(code);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ' ';
    })
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
}

function reportPeriod(month: string, publishedAt: string) {
  const date = new Date(publishedAt);
  const monthIndex = months.findIndex(name => name.toLowerCase() === month.toLowerCase());
  const year = date.getUTCFullYear() - (monthIndex >= date.getUTCMonth() ? 1 : 0);
  const period = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  // Releases describe a completed month. Reject mismatched/ambiguous years, not silently year-shift them.
  const age = (date.getTime() - Date.parse(period)) / 86_400_000;
  if (monthIndex < 0 || age < 0 || age > 100) throw new Error('Dodge reporting month mismatch');
  return period;
}

function oneMatch(text: string, expression: RegExp): RegExpMatchArray {
  const matches = [...text.matchAll(expression)];
  if (matches.length !== 1) throw new Error('Dodge observation missing or ambiguous');
  return matches[0];
}

export function parseDodgeRelease(payload: unknown, series: DodgeSeries, now = new Date()): MarketPoint[] {
  const row = object(payload);
  const category = series === 'momentum' ? 4 : 5;
  if (!Array.isArray(row.categories) || !row.categories.includes(category) || row.status !== 'publish') throw new Error('Dodge release identity mismatch');
  if (typeof row.date_gmt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(row.date_gmt)) throw new Error('Dodge publication date missing');
  const publishedAt = row.date_gmt + 'Z';
  if (!Number.isFinite(Date.parse(publishedAt)) || new Date(publishedAt).toISOString().slice(0, 19) !== row.date_gmt || Date.parse(publishedAt) > now.getTime()) throw new Error('Dodge publication date invalid');
  const sourceUrl = String(row.link);
  const url = new URL(sourceUrl);
  if (url.origin !== 'https://www.construction.com' || url.username || url.password || url.search || url.hash || !/^\/[a-z0-9/-]+\/$/.test(url.pathname)) throw new Error('Dodge source URL invalid');
  const title = plainText(object(row.title).rendered);
  if (!(series === 'momentum' ? /^Dodge Momentum Index\b/i : /^(?:Total )?Construction Starts\b/i).test(title)) throw new Error('Dodge release title mismatch');
  const text = plainText(object(row.content).rendered);
  const points: MarketPoint[] = [];
  const add = (period: string, raw: string, multiplier = 1) => {
    const value = Number(raw.replaceAll(',', '')) * multiplier;
    if (!Number.isFinite(value) || value <= 0) throw new Error('Dodge value invalid');
    points.push({ period, value, preliminary: false, sourceUrl, publishedAt });
  };
  if (series === 'momentum') {
    // Pin the total DMI, the reporting month and index base; never a commercial sub-index or percentage.
    const match = oneMatch(text, new RegExp(`The Dodge Momentum Index \\(DMI\\)[\\s\\S]{0,250}?\\bin (${monthPattern}) to ${numberPattern} \\(2000\\s*=\\s*100\\)`, 'gi'));
    const period = reportPeriod(match[1], publishedAt);
    if (!new RegExp(`\\bin ${match[1]}\\b`, 'i').test(title)) throw new Error('Dodge title month mismatch');
    add(period, match[2]);
    const remainder = text.slice(match.index! + match[0].length, match.index! + match[0].length + 160);
    if (/^ from\b/i.test(remainder)) {
      const prior = /^ from the (?:(?:upwardly|downwardly) revised |revised )?(\w+) reading of (\d+(?:\.\d+)?)/i.exec(remainder);
      if (!prior) throw new Error('Dodge prior observation invalid');
      const previous = new Date(period);
      previous.setUTCMonth(previous.getUTCMonth() - 1);
      if (months[previous.getUTCMonth()].toLowerCase() !== prior[1].toLowerCase()) throw new Error('Dodge prior month mismatch');
      add(previous.toISOString().slice(0, 10), prior[2]);
    }
  } else {
    // Anchor on nonresidential BUILDING starts and an annualized dollar level, excluding total,
    // residential and nonbuilding starts, YTD/rolling-year percentages, and individual projects.
    const match = oneMatch(text, new RegExp(`Nonresidential building starts [^.!?]{0,70}?(?:\\d+\\.\\d+%[^.!?]{0,30}?)?\\bin (${monthPattern}) to a seasonally adjusted annual rate of \\$${numberPattern} (billion|trillion)\\b`, 'gi'));
    if (!new RegExp(`\\bin ${match[1]}\\b`, 'i').test(title)) throw new Error('Dodge title month mismatch');
    add(reportPeriod(match[1], publishedAt), match[2], match[3].toLowerCase() === 'trillion' ? 1_000_000 : 1000);
  }
  return normalizeMarketPoints(points, now);
}

/** A rolling window of six releases, not a complete historical dataset. New releases revise prior periods. */
export function parseDodgeReleases(payload: unknown, series: DodgeSeries, now = new Date()): MarketPoint[] {
  if (!Array.isArray(payload) || !payload.length || payload.length > 6) throw new Error('Dodge release list invalid');
  const points = new Map<string, MarketPoint>();
  // Parse every returned release; an unreadable latest release must fail instead of appearing current.
  const releases = payload.map(row => parseDodgeRelease(row, series, now));
  for (const point of releases.flat()) {
    const previous = points.get(point.period);
    if (previous?.publishedAt === point.publishedAt && previous.value !== point.value) throw new Error('Conflicting Dodge release observations');
    if (!previous || point.publishedAt! > previous.publishedAt!) points.set(point.period, point);
  }
  return normalizeMarketPoints([...points.values()], now);
}

export function dodgeReleasesUrl(series: DodgeSeries) {
  const params = new URLSearchParams({ categories: series === 'momentum' ? '4' : '5', per_page: '6', orderby: 'date', order: 'desc', status: 'publish', _fields: 'id,date_gmt,status,link,title,content,categories' });
  return `https://www.construction.com/wp-json/wp/v2/posts?${params}`;
}

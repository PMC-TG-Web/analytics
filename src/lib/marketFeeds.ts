import { marketSeries, normalizeMarketPoints, numericValue, type MarketFeedResult, type MarketPoint } from './marketSeries.ts';

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export function parseBls(payload: unknown, series: string, now = new Date()): MarketPoint[] {
  const data = object(payload);
  if (data.status !== 'REQUEST_SUCCEEDED') throw new Error('BLS rejected the request');
  const matches = array(object(data.Results).series).map(object).filter(row => row.seriesID === series);
  if (matches.length !== 1) throw new Error('BLS series missing or ambiguous');
  const points = array(matches[0].data).map(object).flatMap(row => {
    const month = /^M(0[1-9]|1[0-2])$/.exec(String(row.period));
    const value = numericValue(row.value);
    if (!month || !/^\d{4}$/.test(String(row.year)) || value === null) return [];
    return [{ period: `${row.year}-${month[1]}-01`, value, preliminary: array(row.footnotes).some(note => /preliminary/i.test(String(object(note).text))) }];
  });
  return normalizeMarketPoints(points, now);
}

export function parseFred(payload: unknown, now = new Date()): MarketPoint[] {
  const data = object(payload);
  if (!Array.isArray(data.observations) || data.error_code) throw new Error('FRED response invalid');
  if (Number(data.count) > data.observations.length || Number(data.offset ?? 0) !== 0) throw new Error('FRED response truncated');
  return normalizeMarketPoints(data.observations.map(object).flatMap(row => {
    const value = numericValue(row.value);
    return value === null ? [] : [{ period: String(row.date), value, preliminary: false }];
  }), now);
}

export function parseEia(payload: unknown, series: string, now = new Date()): MarketPoint[] {
  const response = object(object(payload).response);
  if (!Array.isArray(response.data)) throw new Error('EIA response invalid');
  if (Number(response.total) > response.data.length) throw new Error('EIA response truncated');
  const rows = response.data.map(object);
  if (rows.some(row => row.series !== series || row.units !== '$/GAL')) throw new Error('EIA series or units mismatch');
  return normalizeMarketPoints(rows.flatMap(row => {
    const value = numericValue(row.value);
    return value === null ? [] : [{ period: String(row.period), value, preliminary: false }];
  }), now);
}

// Error messages deliberately exclude provider payloads/URLs, which can contain API keys.
export async function fetchMarketJson(url: string, init: RequestInit, fetcher: typeof fetch = fetch): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher(url, { ...init, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8_000) });
      if ((response.status === 429 || response.status >= 500) && attempt === 0) {
        const retry = response.headers.get('retry-after');
        const delay = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 500;
        await response.body?.cancel();
        // Do not retry early if a provider asks us to wait beyond this bounded run.
        if (!Number.isFinite(delay) || delay > 1500) throw new Error('Provider cooldown');
        await new Promise(resolve => setTimeout(resolve, Math.max(0, delay)));
        continue;
      }
      if (!response.ok) throw new Error('Provider HTTP failure');
      return await response.json();
    } catch {
      throw new Error('Source unavailable or invalid response');
    }
  }
  throw new Error('Source unavailable');
}

export async function fetchMarketFeeds(options: { now?: Date; env?: NodeJS.ProcessEnv; fetcher?: typeof fetch } = {}): Promise<MarketFeedResult[]> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const checkedAt = now.toISOString();
  const start = `${now.getUTCFullYear() - 2}-01-01`;
  const end = checkedAt.slice(0, 10);
  const request = (url: string, init: RequestInit = {}) => fetchMarketJson(url, init, options.fetcher);
  // One batch stays well below even BLS's unregistered daily request limit.
  const bls = request('https://api.bls.gov/publicAPI/v2/timeseries/data/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seriesid: marketSeries.filter(s => s.provider === 'bls').map(s => s.series), startyear: start.slice(0, 4), endyear: String(now.getUTCFullYear()), ...(env.BLS_API_KEY?.trim() ? { registrationkey: env.BLS_API_KEY.trim() } : {}) }),
  });
  return Promise.all(marketSeries.map(async definition => {
    const result: MarketFeedResult = { id: definition.id, checkedAt, status: 'ok', message: null, points: [] };
    const requiredKey = definition.provider === 'fred' ? 'FRED_API_KEY' : definition.provider === 'eia' ? 'EIA_API_KEY' : null;
    if (requiredKey && !env[requiredKey]?.trim()) return { ...result, status: 'unconfigured' as const, message: `${requiredKey} is not configured` };
    try {
      if (definition.provider === 'bls') result.points = parseBls(await bls, definition.series, now);
      if (definition.provider === 'fred') {
        const params = new URLSearchParams({ series_id: definition.series, api_key: env.FRED_API_KEY!.trim(), file_type: 'json', observation_start: start, observation_end: end, sort_order: 'asc', limit: '10000' });
        result.points = parseFred(await request(`https://api.stlouisfed.org/fred/series/observations?${params}`), now);
      }
      if (definition.provider === 'eia') {
        const params = new URLSearchParams({ api_key: env.EIA_API_KEY!.trim(), frequency: 'weekly', 'data[0]': 'value', 'facets[series][]': definition.series, start, end, 'sort[0][column]': 'period', 'sort[0][direction]': 'asc', length: '5000' });
        result.points = parseEia(await request(`https://api.eia.gov/v2/petroleum/pri/gnd/data/?${params}`), definition.series, now);
      }
      if (!result.points.length) throw new Error('Empty series');
    } catch {
      result.status = 'error'; result.message = 'Source unavailable, empty, or invalid; previous observations retained.'; result.points = [];
    }
    return result;
  }));
}

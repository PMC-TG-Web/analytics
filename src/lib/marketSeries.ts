/** Explicit publisher series identities. Geography and units never come from display names. */
export type MarketSeries = {
  id: string; card: string; name: string; provider: 'bls' | 'fred' | 'eia'; series: string;
  geography: string; units: string; frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  kind: 'cost' | 'demand' | 'context'; format: 'index' | 'jobs' | 'dollars' | 'millions' | 'percent' | 'diesel';
  staleDays: number; note: string; source: string; sourceUrl: string;
};

export const marketSeries: MarketSeries[] = [
  { id: 'ready-mix', card: 'Ready-mix concrete PPI', name: 'Ready-mix concrete PPI', provider: 'bls', series: 'WPU1333', geography: 'U.S.', units: 'Index 1982=100 · not seasonally adjusted', frequency: 'monthly', kind: 'cost', format: 'index', staleDays: 90, source: 'BLS', sourceUrl: 'https://data.bls.gov/timeseries/WPU1333', note: 'Producer-price benchmark, not a delivered local supplier quote.' },
  { id: 'cement', card: 'Cement PPI', name: 'Cement PPI', provider: 'bls', series: 'WPU1322', geography: 'U.S.', units: 'Index 1982=100 · not seasonally adjusted', frequency: 'monthly', kind: 'cost', format: 'index', staleDays: 90, source: 'BLS', sourceUrl: 'https://data.bls.gov/timeseries/WPU1322', note: 'Hydraulic cement producer prices. Compare with actual supplier quotes.' },
  { id: 'steel', card: 'Steel and rebar PPI', name: 'Steel mill products PPI', provider: 'bls', series: 'WPU1017', geography: 'U.S.', units: 'Index 1982=100 · not seasonally adjusted', frequency: 'monthly', kind: 'cost', format: 'index', staleDays: 90, source: 'BLS', sourceUrl: 'https://data.bls.gov/timeseries/WPU1017', note: 'Broad steel mill products proxy; this is not a rebar-specific price series.' },
  { id: 'employment-us', card: 'Construction employment', name: 'U.S. construction employment', provider: 'bls', series: 'CES2000000001', geography: 'U.S.', units: 'Thousands of jobs · seasonally adjusted', frequency: 'monthly', kind: 'demand', format: 'jobs', staleDays: 75, source: 'BLS', sourceUrl: 'https://data.bls.gov/timeseries/CES2000000001', note: 'National construction payrolls measure jobs, not available workers.' },
  { id: 'employment-pa', card: 'Pennsylvania construction employment', name: 'Pennsylvania construction employment', provider: 'bls', series: 'SMS42000002000000001', geography: 'Pennsylvania', units: 'Thousands of jobs · not seasonally adjusted', frequency: 'monthly', kind: 'demand', format: 'jobs', staleDays: 100, source: 'BLS', sourceUrl: 'https://data.bls.gov/timeseries/SMS42000002000000001', note: 'State construction employment. Year-over-year comparison reduces seasonal distortion; this does not isolate the local service corridor.' },
  { id: 'wages', card: 'Average construction wages', name: 'Average construction weekly earnings', provider: 'bls', series: 'CES2000000030', geography: 'U.S.', units: 'Dollars per week · all employees · seasonally adjusted', frequency: 'monthly', kind: 'cost', format: 'dollars', staleDays: 75, source: 'BLS', sourceUrl: 'https://data.bls.gov/timeseries/CES2000000030', note: 'Weekly earnings reflect both hourly pay and hours worked; this is not an hourly wage rate.' },
  { id: 'unemployment-pa', card: 'Construction unemployment', name: 'Pennsylvania unemployment', provider: 'bls', series: 'LAUST420000000000003', geography: 'Pennsylvania · all industries', units: 'Percent · not seasonally adjusted', frequency: 'monthly', kind: 'context', format: 'percent', staleDays: 100, source: 'BLS', sourceUrl: 'https://data.bls.gov/timeseries/LAUST420000000000003', note: 'All-industry labor availability context, not a construction unemployment rate.' },
  { id: 'spending', card: 'Construction spending', name: 'Nonresidential construction spending', provider: 'fred', series: 'TLNRESCONS', geography: 'U.S.', units: 'Millions of dollars · seasonally adjusted annual rate', frequency: 'monthly', kind: 'demand', format: 'millions', staleDays: 100, source: 'Census via FRED', sourceUrl: 'https://fred.stlouisfed.org/series/TLNRESCONS', note: 'Nominal nonresidential spending, public and private. Annualized rate, not dollars spent in a single month; not adjusted for inflation.' },
  { id: 'rates', card: 'Interest rates', name: 'Effective federal funds rate', provider: 'fred', series: 'DFF', geography: 'U.S.', units: 'Percent', frequency: 'daily', kind: 'context', format: 'percent', staleDays: 10, source: 'Federal Reserve via FRED', sourceUrl: 'https://fred.stlouisfed.org/series/DFF', note: 'Overnight policy-rate benchmark, not a construction-loan quote or the target range.' },
  { id: 'lending', card: 'Commercial lending conditions', name: 'Commercial lending standards', provider: 'fred', series: 'DRTSCILM', geography: 'U.S.', units: 'Net percent tightening · not seasonally adjusted', frequency: 'quarterly', kind: 'context', format: 'percent', staleDays: 180, source: 'Federal Reserve via FRED', sourceUrl: 'https://fred.stlouisfed.org/series/DRTSCILM', note: 'Large and middle-market commercial/industrial loans, not commercial real estate. Positive means net tightening; negative means net easing.' },
  { id: 'diesel', card: 'Diesel prices', name: 'Central Atlantic diesel', provider: 'eia', series: 'EMD_EPD2D_PTE_R1Y_DPG', geography: 'Central Atlantic (PADD 1B)', units: 'Dollars per gallon · retail on-highway diesel', frequency: 'weekly', kind: 'cost', format: 'diesel', staleDays: 21, source: 'EIA', sourceUrl: 'https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=EMD_EPD2D_PTE_R1Y_DPG&f=W', note: 'Regional benchmark covering PA and neighboring states, not a local delivery quote.' },
];

export type MarketPoint = { period: string; value: number; preliminary: boolean };
export type MarketFeedResult = { id: string; checkedAt: string; status: 'ok' | 'error' | 'unconfigured'; message: string | null; points: MarketPoint[] };
export type SavedMarketSeries = MarketFeedResult & { lastSuccessAt: string | null };

export function numericValue(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function normalizeMarketPoints(points: MarketPoint[], now = new Date()): MarketPoint[] {
  const today = now.toISOString().slice(0, 10);
  const byPeriod = new Map<string, MarketPoint>();
  for (const point of points) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(point.period) || !Number.isFinite(Date.parse(point.period)) || new Date(point.period).toISOString().slice(0, 10) !== point.period || point.period > today || !Number.isFinite(point.value)) continue;
    const previous = byPeriod.get(point.period);
    if (previous && previous.value !== point.value) throw new Error('Conflicting observations for one period');
    byPeriod.set(point.period, point);
  }
  return [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export function marketChanges(points: MarketPoint[], frequency: MarketSeries['frequency']) {
  const latest = points.at(-1);
  if (!latest) return { latest: null, previousChange: null, annualChange: null };
  const date = new Date(latest.period + 'T00:00:00Z');
  if (frequency === 'monthly' || frequency === 'quarterly') date.setUTCMonth(date.getUTCMonth() - (frequency === 'quarterly' ? 3 : 1));
  else date.setUTCDate(date.getUTCDate() - (frequency === 'weekly' ? 7 : 1));
  const previous = points.find(point => point.period === date.toISOString().slice(0, 10));
  const annualDate = new Date(latest.period + 'T00:00:00Z');
  if (frequency === 'weekly') annualDate.setUTCDate(annualDate.getUTCDate() - 364);
  else annualDate.setUTCFullYear(annualDate.getUTCFullYear() - 1);
  const annual = points.find(point => point.period === annualDate.toISOString().slice(0, 10));
  const change = (base?: MarketPoint) => base && base.value !== 0 ? (latest.value / base.value - 1) * 100 : null;
  return { latest, previousChange: change(previous), annualChange: change(annual), previous, annual };
}

export function marketFreshness(definition: MarketSeries, saved?: SavedMarketSeries, now = new Date()) {
  if (!saved?.points.length) return saved?.status === 'unconfigured' ? 'Setup needed' : 'Awaiting first sync';
  if (saved.status !== 'ok') return 'Refresh failed';
  const age = (now.getTime() - Date.parse(saved.points.at(-1)!.period)) / 86_400_000;
  if (age > definition.staleDays) return 'Release overdue';
  if (!saved.lastSuccessAt || now.getTime() - Date.parse(saved.lastSuccessAt) > 48 * 3_600_000) return 'Refresh overdue';
  return 'Current';
}

export function marketSignal(definition: MarketSeries, saved?: SavedMarketSeries, now = new Date()): 'strong' | 'mixed' | 'weak' | 'watch' {
  if (marketFreshness(definition, saved, now) !== 'Current' || definition.kind === 'context') return 'watch';
  const annual = marketChanges(saved!.points, definition.frequency).annualChange;
  if (annual == null) return 'watch';
  // Transparent planning heuristic: +/-1% year-over-year neutral band; costs invert demand direction.
  if (Math.abs(annual) <= 1) return 'mixed';
  return (annual > 0) === (definition.kind === 'demand') ? 'strong' : 'weak';
}

export function formatMarketValue(definition: MarketSeries, value: number) {
  if (definition.format === 'percent') return `${value.toFixed(2)}%`;
  if (definition.format === 'diesel') return `$${value.toFixed(3)}/gal`;
  if (definition.format === 'dollars') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  if (definition.format === 'millions') return `$${(value / 1000).toFixed(1)}B`;
  if (definition.format === 'jobs') return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}K jobs`;
  return value.toFixed(3);
}

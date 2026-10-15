/** Explicit publisher series identities. Geography and units never come from display names. */
export type MarketSeries = {
  id: string; card: string; name: string; provider: 'bls' | 'fred' | 'eia' | 'dodge' | 'aia'; series: string;
  group: 'Pipeline' | 'Material costs' | 'Labor' | 'Current market' | 'Financing';
  geography: string; units: string; frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly';
  kind: 'cost' | 'demand' | 'context'; format: 'index' | 'diffusion' | 'jobs' | 'dollars' | 'millions' | 'percent' | 'diesel';
  staleDays: number; note: string; source: string; sourceUrl: string;
};

export const marketSeries: MarketSeries[] = [
  { id: 'aia-billings', group: 'Pipeline', card: 'Architecture Billings Index (ABI)', name: 'Architecture Billings Index (ABI)', provider: 'aia', series: 'billings', geography: 'U.S.', units: 'Diffusion index · 50 = no change', frequency: 'monthly', kind: 'demand', format: 'diffusion', staleDays: 100, source: 'AIA', sourceUrl: 'https://www.aia.org/partner-aia/market-research-partnership-opportunities/aia-architecture-billings-index', note: 'Architecture firm billings; an early indicator of nonresidential construction activity, not construction spending. Above 50 indicates growth from the prior month; below 50 indicates decline. Changes are index points.' },
  { id: 'aia-inquiries', group: 'Pipeline', card: 'Architecture project inquiries', name: 'Architecture project inquiries', provider: 'aia', series: 'inquiries', geography: 'U.S.', units: 'Diffusion index · 50 = no change', frequency: 'monthly', kind: 'demand', format: 'diffusion', staleDays: 100, source: 'AIA', sourceUrl: 'https://www.aia.org/partner-aia/market-research-partnership-opportunities/aia-architecture-billings-index', note: 'Potential new design work. An inquiry is not a signed contract or awarded construction job. Above 50 indicates growth from the prior month; below 50 indicates decline. Changes are index points.' },
  { id: 'aia-contracts', group: 'Pipeline', card: 'New design contracts', name: 'New design contracts', provider: 'aia', series: 'contracts', geography: 'U.S.', units: 'Diffusion index · 50 = no change', frequency: 'monthly', kind: 'demand', format: 'diffusion', staleDays: 100, source: 'AIA', sourceUrl: 'https://www.aia.org/partner-aia/market-research-partnership-opportunities/aia-architecture-billings-index', note: 'Newly signed architecture design contracts; not contractor awards or company sales. Above 50 indicates growth from the prior month; below 50 indicates decline. Changes are index points.' },
  { id: 'dodge-momentum', group: 'Pipeline', card: 'Dodge Momentum Index', name: 'Dodge Momentum Index', provider: 'dodge', series: 'momentum', geography: 'U.S.', units: 'Index 2000=100 · three-month moving value', frequency: 'monthly', kind: 'demand', format: 'index', staleDays: 80, source: 'Dodge', sourceUrl: 'https://www.construction.com/category/dodge-momentum-index/', note: 'Nonresidential buildings entering planning. National pipeline indicator, not local starts or awarded work. Recent releases can revise earlier readings.' },
  { id: 'dodge-starts', group: 'Current market', card: 'Construction starts', name: 'Nonresidential building starts', provider: 'dodge', series: 'nonresidential-starts', geography: 'U.S.', units: 'Millions of dollars · seasonally adjusted annual rate', frequency: 'monthly', kind: 'demand', format: 'millions', staleDays: 100, source: 'Dodge', sourceUrl: 'https://www.construction.com/category/total-construction-starts/', note: 'Commercial, institutional and manufacturing buildings; excludes residential and nonbuilding infrastructure. Annualized project value, not monthly spending. Comparisons use saved release levels, which may be revised.' },
  { id: 'ready-mix', group: 'Material costs', card: 'Ready-mix concrete PPI', name: 'Ready-mix concrete PPI', provider: 'bls', series: 'WPU1333', geography: 'U.S.', units: 'Index 1982=100 · not seasonally adjusted', frequency: 'monthly', kind: 'cost', format: 'index', staleDays: 90, source: 'BLS', sourceUrl: 'https://data.bls.gov/timeseries/WPU1333', note: 'Producer-price benchmark, not a delivered local supplier quote.' },
  { id: 'cement', group: 'Material costs', card: 'Cement PPI', name: 'Cement PPI', provider: 'bls', series: 'WPU1322', geography: 'U.S.', units: 'Index 1982=100 · not seasonally adjusted', frequency: 'monthly', kind: 'cost', format: 'index', staleDays: 90, source: 'BLS', sourceUrl: 'https://data.bls.gov/timeseries/WPU1322', note: 'Hydraulic cement producer prices. Compare with actual supplier quotes.' },
  { id: 'steel', group: 'Material costs', card: 'Steel and rebar PPI', name: 'Steel mill products PPI', provider: 'bls', series: 'WPU1017', geography: 'U.S.', units: 'Index 1982=100 · not seasonally adjusted', frequency: 'monthly', kind: 'cost', format: 'index', staleDays: 90, source: 'BLS', sourceUrl: 'https://data.bls.gov/timeseries/WPU1017', note: 'Broad steel mill products proxy; this is not a rebar-specific price series.' },
  { id: 'employment-us', group: 'Labor', card: 'Construction employment', name: 'U.S. construction employment', provider: 'bls', series: 'CES2000000001', geography: 'U.S.', units: 'Thousands of jobs · seasonally adjusted', frequency: 'monthly', kind: 'demand', format: 'jobs', staleDays: 75, source: 'BLS', sourceUrl: 'https://data.bls.gov/timeseries/CES2000000001', note: 'National construction payrolls measure jobs, not available workers.' },
  { id: 'employment-pa', group: 'Labor', card: 'Pennsylvania construction employment', name: 'Pennsylvania construction employment', provider: 'bls', series: 'SMS42000002000000001', geography: 'Pennsylvania', units: 'Thousands of jobs · not seasonally adjusted', frequency: 'monthly', kind: 'demand', format: 'jobs', staleDays: 100, source: 'BLS', sourceUrl: 'https://data.bls.gov/timeseries/SMS42000002000000001', note: 'State construction employment. Year-over-year comparison reduces seasonal distortion; this does not isolate the local service corridor.' },
  { id: 'wages', group: 'Labor', card: 'Average construction wages', name: 'Average construction weekly earnings', provider: 'bls', series: 'CES2000000030', geography: 'U.S.', units: 'Dollars per week · all employees · seasonally adjusted', frequency: 'monthly', kind: 'cost', format: 'dollars', staleDays: 75, source: 'BLS', sourceUrl: 'https://data.bls.gov/timeseries/CES2000000030', note: 'Weekly earnings reflect both hourly pay and hours worked; this is not an hourly wage rate.' },
  { id: 'unemployment-pa', group: 'Labor', card: 'Construction unemployment', name: 'Pennsylvania unemployment', provider: 'bls', series: 'LAUST420000000000003', geography: 'Pennsylvania · all industries', units: 'Percent · not seasonally adjusted', frequency: 'monthly', kind: 'context', format: 'percent', staleDays: 100, source: 'BLS', sourceUrl: 'https://data.bls.gov/timeseries/LAUST420000000000003', note: 'All-industry labor availability context, not a construction unemployment rate.' },
  { id: 'spending', group: 'Current market', card: 'Construction spending', name: 'Nonresidential construction spending', provider: 'fred', series: 'TLNRESCONS', geography: 'U.S.', units: 'Millions of dollars · seasonally adjusted annual rate', frequency: 'monthly', kind: 'demand', format: 'millions', staleDays: 100, source: 'Census via FRED', sourceUrl: 'https://fred.stlouisfed.org/series/TLNRESCONS', note: 'Nominal nonresidential spending, public and private. Annualized rate, not dollars spent in a single month; not adjusted for inflation.' },
  { id: 'rates', group: 'Financing', card: 'Interest rates', name: 'Effective federal funds rate', provider: 'fred', series: 'DFF', geography: 'U.S.', units: 'Percent', frequency: 'daily', kind: 'context', format: 'percent', staleDays: 10, source: 'Federal Reserve via FRED', sourceUrl: 'https://fred.stlouisfed.org/series/DFF', note: 'Overnight policy-rate benchmark, not a construction-loan quote or the target range.' },
  { id: 'lending', group: 'Financing', card: 'Commercial lending conditions', name: 'Commercial lending standards', provider: 'fred', series: 'DRTSCILM', geography: 'U.S.', units: 'Net percent tightening · not seasonally adjusted', frequency: 'quarterly', kind: 'context', format: 'percent', staleDays: 180, source: 'Federal Reserve via FRED', sourceUrl: 'https://fred.stlouisfed.org/series/DRTSCILM', note: 'Large and middle-market commercial/industrial loans, not commercial real estate. Positive means net tightening; negative means net easing.' },
  { id: 'diesel', group: 'Material costs', card: 'Diesel prices', name: 'Central Atlantic diesel', provider: 'eia', series: 'EMD_EPD2D_PTE_R1Y_DPG', geography: 'Central Atlantic (PADD 1B)', units: 'Dollars per gallon · retail on-highway diesel', frequency: 'weekly', kind: 'cost', format: 'diesel', staleDays: 21, source: 'EIA', sourceUrl: 'https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=EMD_EPD2D_PTE_R1Y_DPG&f=W', note: 'Regional benchmark covering PA and neighboring states, not a local delivery quote.' },
];

export type MarketPoint = { period: string; value: number; preliminary: boolean; sourceUrl?: string; publishedAt?: string };
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
  if (definition.format === 'diffusion') {
    const latest = saved!.points.at(-1)!.value;
    return latest > 50 ? 'strong' : latest < 50 ? 'weak' : 'mixed';
  }
  const annual = marketChanges(saved!.points, definition.frequency).annualChange;
  if (annual == null) return 'watch';
  // Transparent planning heuristic: +/-1% year-over-year neutral band; costs invert demand direction.
  if (Math.abs(annual) <= 1) return 'mixed';
  return (annual > 0) === (definition.kind === 'demand') ? 'strong' : 'weak';
}

export function formatMarketValue(definition: MarketSeries, value: number) {
  if (definition.format === 'diffusion') return value.toFixed(1);
  if (definition.format === 'percent') return `${value.toFixed(2)}%`;
  if (definition.format === 'diesel') return `$${value.toFixed(3)}/gal`;
  if (definition.format === 'dollars') return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  if (definition.format === 'millions') return `$${(value / 1000).toFixed(1)}B`;
  if (definition.format === 'jobs') return `${value.toLocaleString('en-US', { maximumFractionDigits: 1 })}K jobs`;
  return value.toFixed(3);
}

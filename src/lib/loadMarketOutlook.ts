import { readMarketSnapshots, readLancasterSnapshot } from './marketStore.ts';
import type { SavedMarketSeries } from './marketSeries.ts';
import type { SavedLancaster } from './marketLancaster.ts';

export async function loadMarketOutlook(): Promise<{ snapshots: SavedMarketSeries[]; local: SavedLancaster | null; localError: string | null; error: string | null }> {
  const [series, local] = await Promise.allSettled([readMarketSnapshots(), readLancasterSnapshot()]);
  return { snapshots: series.status === 'fulfilled' ? series.value : [], error: series.status === 'fulfilled' ? null : 'Saved market data is unavailable. Please try again later.', local: local.status === 'fulfilled' ? local.value : null, localError: local.status === 'fulfilled' ? null : 'Saved Lancaster County plans are unavailable. Please try again later.' };
}

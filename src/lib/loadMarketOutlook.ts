import { readMarketSnapshots, readLancasterSnapshot, readManheimSnapshot } from './marketStore.ts';
import type { SavedMarketSeries } from './marketSeries.ts';
import type { SavedLancaster } from './marketLancaster.ts';
import type { SavedManheim } from './marketManheim.ts';

export async function loadMarketOutlook(): Promise<{ snapshots: SavedMarketSeries[]; local: SavedLancaster | null; localError: string | null; manheim: SavedManheim | null; manheimError: string | null; error: string | null }> {
  const [series, local, manheim] = await Promise.allSettled([readMarketSnapshots(), readLancasterSnapshot(), readManheimSnapshot()]);
  return { snapshots: series.status === 'fulfilled' ? series.value : [], error: series.status === 'fulfilled' ? null : 'Saved market data is unavailable. Please try again later.', local: local.status === 'fulfilled' ? local.value : null, localError: local.status === 'fulfilled' ? null : 'Saved Lancaster County plans are unavailable. Please try again later.', manheim: manheim.status === 'fulfilled' ? manheim.value : null, manheimError: manheim.status === 'fulfilled' ? null : 'Saved Manheim Township projects are unavailable. Please try again later.' };
}

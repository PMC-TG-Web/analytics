import { readMarketSnapshots, readLancasterSnapshot, readManheimSnapshot, readMunicipalSnapshots } from './marketStore.ts';
import type { SavedMarketSeries } from './marketSeries.ts';
import type { SavedLancaster } from './marketLancaster.ts';
import type { SavedManheim } from './marketManheim.ts';
import type { SavedMunicipal } from './marketMunicipal.ts';

export async function loadMarketOutlook(): Promise<{ snapshots: SavedMarketSeries[]; local: SavedLancaster | null; localError: string | null; manheim: SavedManheim | null; manheimError: string | null; municipal: SavedMunicipal[]; municipalError: string | null; error: string | null }> {
  const [series, local, manheim, municipal] = await Promise.allSettled([readMarketSnapshots(), readLancasterSnapshot(), readManheimSnapshot(), readMunicipalSnapshots()]);
  return { snapshots: series.status === 'fulfilled' ? series.value : [], error: series.status === 'fulfilled' ? null : 'Saved market data is unavailable. Please try again later.', local: local.status === 'fulfilled' ? local.value : null, localError: local.status === 'fulfilled' ? null : 'Saved Lancaster County plans are unavailable. Please try again later.', manheim: manheim.status === 'fulfilled' ? manheim.value : null, manheimError: manheim.status === 'fulfilled' ? null : 'Saved Manheim Township projects are unavailable. Please try again later.', municipal: municipal.status === 'fulfilled' ? municipal.value : [], municipalError: municipal.status === 'fulfilled' ? null : 'Saved municipal records are unavailable. Please try again later.' };
}

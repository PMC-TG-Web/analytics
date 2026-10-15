import { readMarketSnapshots } from './marketStore.ts';
import type { SavedMarketSeries } from './marketSeries.ts';

export async function loadMarketOutlook(): Promise<{ snapshots: SavedMarketSeries[]; error: string | null }> {
  try { return { snapshots: await readMarketSnapshots(), error: null }; }
  catch { return { snapshots: [], error: 'Saved market data is unavailable. Please try again later.' }; }
}

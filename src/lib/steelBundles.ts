import type { SteelItem } from './steelNeeds.ts';

/** Owner-supplied pieces per bundle for standard 20-foot rebar sticks. */
export const REBAR_BUNDLE_SIZES: Readonly<Record<number, number>> = Object.freeze({ 3: 264, 4: 150, 5: 96, 6: 68, 7: 49, 8: 38 });

export function steelBundleSize(item: Pick<SteelItem, 'description' | 'kind' | 'unit'>): number | null {
  if (item.kind !== 'Rebar' || item.unit !== 'EA') return null;
  const size = /^#(\d+) Rebar - 20' Pc$/.exec(item.description)?.[1];
  return size ? REBAR_BUNDLE_SIZES[Number(size)] ?? null : null;
}

export function steelBundles(item: Pick<SteelItem, 'description' | 'kind' | 'unit'>, quantity: number) {
  const piecesPerBundle = steelBundleSize(item);
  if (!piecesPerBundle || !Number.isFinite(quantity) || quantity < 0) return null;
  // Quantities are stored to four decimal places; discard floating-point addition noise before rounding up.
  const pieces = Math.round(quantity * 10000) / 10000;
  const wholeBundles = Math.ceil(pieces / piecesPerBundle);
  return { piecesPerBundle, equivalent: pieces / piecesPerBundle, wholeBundles, wholeBundlePieces: wholeBundles * piecesPerBundle,
    extraPieces: Math.round((wholeBundles * piecesPerBundle - pieces) * 10000) / 10000 };
}

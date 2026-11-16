import { steelBundles } from '@/lib/steelBundles';
import type { SteelItem } from '@/lib/steelNeeds';

const bundles = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
/** Pieces converted straight to bundles for known-size rebar; nothing is shown for other materials. */
export default function BundleQuantity({ item, quantity }: { item: SteelItem; quantity: number }) {
  const pack = steelBundles(item, quantity);
  if (!pack) return null;
  const text = bundles.format(pack.equivalent);
  return <p className="mt-1 text-xs font-normal text-slate-500">{text} {text === '1' ? 'bundle' : 'bundles'}</p>;
}

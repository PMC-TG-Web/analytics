import { steelBundles } from '@/lib/steelBundles';
import type { SteelItem } from '@/lib/steelNeeds';

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const bundles = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export default function BundleQuantity({ item, quantity, roundUp = false }: { item: SteelItem; quantity: number; roundUp?: boolean }) {
  const pack = steelBundles(item, quantity);
  if (!pack) return null;
  return <p className="mt-1 text-xs font-normal text-slate-500">{roundUp
    ? <>{number.format(pack.wholeBundles)} whole {pack.wholeBundles === 1 ? 'bundle' : 'bundles'}<span className="block">{number.format(pack.wholeBundlePieces)} pcs{pack.extraPieces > 0 && ` · ${number.format(pack.extraPieces)} extra`}</span></>
    : `${bundles.format(pack.equivalent)} bundle equiv.`}</p>;
}

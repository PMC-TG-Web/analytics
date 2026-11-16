'use client';

import { steelOrderWorksheet } from '@/lib/steelOrderWorksheet';
import { steelOrderQuantities, type SteelProject } from '@/lib/steelNeeds';
import { steelBundleSize } from '@/lib/steelBundles';
import BundleQuantity from './BundleQuantity';
import { number } from './format';
import StartStatus from './StartStatus';

const cell = 'px-2 py-3 sm:px-4';
/** What to buy: one line per material and unit, added up across the listed jobs. Orders are recorded under By job. */
export default function BuyingList({ projects, hideOrdered }: { projects: SteelProject[]; hideOrdered: boolean }) {
  const rows = steelOrderWorksheet(projects, hideOrdered ? 'needed' : 'all');
  return <div>
    <div className="overflow-x-auto"><table className="w-full text-xs sm:text-sm" aria-label="Steel buying list"><thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 sm:text-xs"><tr>
      <th className={cell}>Material</th><th className={`${cell} text-right`}>Needed</th><th className={`${cell} text-right text-emerald-800`}>Ordered</th>
      <th className={`${cell} text-right text-sky-900`}>Left to order</th><th className={`${cell} hidden text-right sm:table-cell`}>Jobs</th>
    </tr></thead><tbody>{rows.map(item => <tr key={item.key} className="border-t border-slate-200 align-top">
      <td className={cell}><details><summary className="cursor-pointer py-1 font-semibold text-sky-900 sm:py-0">{item.description}</summary>
        <ul aria-label={`Jobs for ${item.description}`} className="mt-3 space-y-1 text-xs text-slate-600">{item.projects.map(row => {
          const amounts = steelOrderQuantities(row);
          return <li key={row.project.key} className="rounded bg-slate-50 px-2 py-1.5"><span className="font-semibold">{row.project.projectName}</span> · <StartStatus project={row.project} />
            <span className="block tabular-nums">Needed {number.format(row.quantity)} · Ordered {number.format(amounts.orderedQuantity)} · Left to order {number.format(amounts.toOrderQuantity)}</span></li>;
        })}</ul>
      </details><p className="mt-1 text-xs text-slate-500">{item.unit}{steelBundleSize(item) ? ` · ${steelBundleSize(item)} pcs / bundle` : ''}</p>
        {item.changedOrders > 0 && <p className="mt-1 max-w-md text-xs text-amber-800">An estimate changed since its last order. Review that job under By job.</p>}</td>
      <td className={`${cell} text-right tabular-nums`}>{number.format(item.quantity)}<BundleQuantity item={item} quantity={item.quantity} /></td>
      <td className={`${cell} text-right tabular-nums text-emerald-800`}>{number.format(item.orderedQuantity)}<BundleQuantity item={item} quantity={item.orderedQuantity} /></td>
      <td className={`${cell} bg-sky-50 text-right text-base font-bold tabular-nums text-sky-950`}>{number.format(item.toOrderQuantity)}<BundleQuantity item={item} quantity={item.toOrderQuantity} /></td>
      <td className={`${cell} hidden text-right tabular-nums sm:table-cell`}>{item.projects.length}</td>
    </tr>)}</tbody></table></div>
    {!rows.length && <p className="p-10 text-center text-slate-500">{hideOrdered ? 'Nothing is left to order for these jobs.' : 'No materials match these filters.'}</p>}
    <p className="border-t border-slate-200 px-4 py-3 text-xs text-slate-500 sm:px-5">Left to order is worked out job by job, so extra steel ordered for one job never covers another. Bundles are pieces divided by pieces per bundle. Record orders under By job.</p>
  </div>;
}

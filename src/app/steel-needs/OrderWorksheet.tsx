'use client';

import { steelOrderWorksheet, steelOrderListLabels, type SteelOrderList } from '@/lib/steelOrderWorksheet';
import type { ReactNode } from 'react';
import { steelOrderQuantities, type SteelItem, type SteelProject } from '@/lib/steelNeeds';

const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });
const cell = 'px-4 py-3';
export default function OrderWorksheet({ projects, list, onListChange, scope, saving, renderOrderedCheck }: {
  projects: SteelProject[]; list: SteelOrderList; onListChange: (list: SteelOrderList) => void; scope: string; saving: boolean;
  renderOrderedCheck: (project: SteelProject, item: SteelItem) => ReactNode;
}) {
  const rows = steelOrderWorksheet(projects, list);
  return <div>
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 p-5">
      <div><h2 className="text-xl font-bold">Steel order worksheet</h2><p className="mt-1 text-sm text-slate-600">{scope}</p>
        <p className="mt-1 text-xs text-slate-500">One line per material and unit. Expand a line to see the project quantities.</p></div>
      <label className="text-xs font-semibold text-slate-600">Order list<select aria-label="Order list" className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" value={list} onChange={event => onListChange(event.target.value as SteelOrderList)}>
        {Object.entries(steelOrderListLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm" aria-label="Steel order worksheet"><thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500"><tr>
      <th className={cell}>Material description</th><th className={cell}>Unit</th>
      {list === 'all' ? <><th className={`${cell} text-right`}>Full estimate</th><th className={`${cell} text-right text-emerald-800`}>Ordered</th><th className={`${cell} text-right text-sky-900`}>Need to order</th></> : <th className={`${cell} text-right`}>{steelOrderListLabels[list]}</th>}
      <th className={`${cell} text-right`}>Projects</th>
    </tr></thead><tbody>{rows.map(item => <tr key={item.key} className="border-t border-slate-200 align-top">
      <td className={cell}><details><summary className="cursor-pointer font-semibold text-sky-900">{item.description}</summary>
        <ul className="mt-3 space-y-2 text-xs text-slate-600">{item.projects.map(row => {
          const amounts = steelOrderQuantities(row);
          return <li key={row.project.key} className="flex flex-wrap justify-between gap-3 rounded-lg bg-slate-50 p-3"><div><span className="font-semibold">{row.project.projectName}</span> · {row.project.started ? 'Started' : 'Not started'}<br />
            {list === 'all' ? `${number.format(amounts.orderedQuantity)} ordered · ${number.format(amounts.toOrderQuantity)} needed` : `${number.format(list === 'ordered' ? amounts.orderedQuantity : amounts.toOrderQuantity)} ${row.unit}`}</div>
            {renderOrderedCheck(row.project, row)}
          </li>;
        })}</ul>
      </details>{item.changedOrders > 0 && <p className="mt-2 max-w-md text-xs text-amber-800">Estimate changed since marked. Review project quantities; ordered totals retain the saved amount.</p>}</td>
      <td className={cell}>{item.unit}</td>
      {list === 'all' ? <><td className={`${cell} text-right tabular-nums`}>{number.format(item.quantity)}</td><td className={`${cell} text-right font-semibold tabular-nums text-emerald-800`}>{number.format(item.orderedQuantity)}</td><td className={`${cell} bg-sky-50 text-right font-bold tabular-nums text-sky-950`}>{number.format(item.toOrderQuantity)}</td></> : <td className={`${cell} bg-sky-50 text-right text-lg font-bold tabular-nums text-sky-950`}>{number.format(list === 'ordered' ? item.orderedQuantity : item.toOrderQuantity)}</td>}
      <td className={`${cell} text-right tabular-nums`}>{item.projects.length}</td>
    </tr>)}</tbody></table></div>
    {!rows.length && <p className="p-10 text-center text-slate-500">{list === 'ordered' ? 'No materials marked ordered in this scope.' : list === 'needed' ? 'No quantities still need ordering in this scope.' : 'No materials match these filters.'}</p>}
    <p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">{saving ? 'Saving checkmarks… Totals update when confirmed.' : `${rows.length} material lines · Saved checkmarks only`} · Quantities stay separate by description and unit. Need to order is calculated per project; extra ordered steel on one job does not cover another.</p>
  </div>;
}

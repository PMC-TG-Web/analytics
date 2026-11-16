'use client';

import { useId, type ReactNode } from 'react';
import { steelOrderQuantities, type SteelItem, type SteelProject } from '@/lib/steelNeeds';
import { steelBundleSize } from '@/lib/steelBundles';
import { number } from './format';
import StartStatus from './StartStatus';

function Stat({ label, value, tone = '' }: { label: string; value: number; tone?: string }) {
  return <div><dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className={`text-lg tabular-nums ${tone}`}>{number.format(value)}</dd></div>;
}

/** Jobs in planned-start order. Every material line reads the same way: needed, ordered, left to order. */
export default function JobList({ projects, hideOrdered, currentMonth, expanded, onExpand, renderEntry }: {
  projects: SteelProject[]; hideOrdered: boolean; currentMonth: string; expanded: ReadonlySet<string>;
  onExpand: (keys: string[], expand: boolean) => void; renderEntry: (project: SteelProject, item: SteelItem) => ReactNode;
}) {
  const baseId = useId();
  const jobs = projects.map(project => ({ project, items: project.items.filter(item => !hideOrdered || steelOrderQuantities(item).toOrderQuantity > 0) })).filter(job => job.items.length);
  if (!jobs.length) return <p className="p-10 text-center text-slate-500">{hideOrdered ? 'Nothing is left to order for these jobs.' : 'No jobs with steel match these filters. Check Planning / source review below.'}</p>;
  const keys = jobs.map(job => job.project.key), opened = keys.filter(key => expanded.has(key)).length;
  const link = 'font-semibold text-sky-900 underline disabled:text-slate-400 disabled:no-underline';
  return <div className="divide-y divide-slate-200">
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-xs text-slate-500 sm:px-5">
      <span>{jobs.length} {jobs.length === 1 ? 'job' : 'jobs'}{opened > 0 ? ` · ${opened} open` : ' · click a job to open it'}</span>
      <span className="flex gap-4"><button type="button" className={link} disabled={opened === keys.length} onClick={() => onExpand(keys, true)}>Expand all</button>
        <button type="button" className={link} disabled={opened === 0} onClick={() => onExpand(keys, false)}>Collapse all</button></span>
    </div>
    {jobs.map(({ project, items }, index) => {
    const left = project.items.filter(item => steelOrderQuantities(item).toOrderQuantity > 0).length;
    const notes = project.issues.filter(issue => issue !== 'No saved WIP start month.');
    const open = expanded.has(project.key), bodyId = `${baseId}-job-${index}`;
    return <section key={project.key} aria-label={`Steel for ${project.projectName}`} className={open ? 'p-4 sm:p-5' : 'px-4 py-3 sm:px-5'}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div><h3 className="text-base font-bold"><button type="button" aria-expanded={open} aria-controls={bodyId} onClick={() => onExpand([project.key], !open)}
          className="flex items-baseline gap-2 text-left hover:text-sky-900"><span aria-hidden="true" className="w-3 text-slate-500">{open ? '▾' : '▸'}</span>{project.projectName}</button></h3>
          <p className="pl-5 text-xs text-slate-500">{[project.projectNumber, project.customer].filter(Boolean).join(' · ')}</p></div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <StartStatus project={project} />
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${left ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>{left ? `${left} of ${project.items.length} left to order` : 'All steel ordered'}</span>
        </div>
      </div>
      {/* Hidden rather than removed, so a typed quantity and an open log survive collapsing. */}
      <div id={bodyId} hidden={!open}>
      {project.started === false && project.plannedStart && project.plannedStart < currentMonth && <p className="mt-2 text-xs text-amber-800">Planned start has passed with no field entries. Review the WIP plan or source sync.</p>}
      {notes.map(issue => <p key={issue} className="mt-2 text-xs text-amber-800">{issue}</p>)}
      <div className="mt-3">{items.map(item => {
        const amounts = steelOrderQuantities(item), bundle = steelBundleSize(item);
        const percent = item.quantity > 0 ? Math.min(100, Math.round(amounts.orderedQuantity / item.quantity * 100)) : 0;
        return <div key={item.key} role="group" aria-label={`${item.description} for ${project.projectName}`}
          className="grid gap-x-8 gap-y-3 border-t border-slate-100 py-4 lg:grid-cols-[minmax(0,4fr)_minmax(0,5fr)_minmax(0,7fr)]">
          <div><p className="font-semibold">{item.description}</p><p className="text-xs text-slate-500">{item.unit}{bundle ? ` · ${bundle} pcs / bundle` : ''}</p></div>
          <div>
            <dl className="grid grid-cols-3 gap-3">
              <Stat label="Needed" value={item.quantity} />
              <Stat label="Ordered" value={amounts.orderedQuantity} tone="text-emerald-800" />
              <Stat label="Left to order" value={amounts.toOrderQuantity} tone={amounts.toOrderQuantity > 0 ? 'font-bold text-sky-950' : 'text-slate-400'} />
            </dl>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200" role="img" aria-label={`${percent}% ordered`}><div className="h-full rounded-full bg-emerald-600" style={{ width: `${percent}%` }} /></div>
          </div>
          {renderEntry(project, item)}
        </div>;
      })}</div>
      </div>
    </section>;
  })}</div>;
}

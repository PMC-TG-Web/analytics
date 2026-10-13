'use client';

import { Fragment, useMemo, useState } from 'react';
import { billingDistributionCsv, distributeBillingInvoice, type BillingMonthGroup } from '@/lib/billingDistribution';
import { downloadCsv, fieldClass, hours } from './billingAnalyticsUi';

const dollars = (cents: number) => (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const percent = (share: number) => `${(share * 100).toFixed(2)}%`;

export default function BillingMonth({ month, initiallyOpen }: { month: BillingMonthGroup; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [selected, setSelected] = useState(() => month.projects.map(project => project.projectId));
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const label = new Date(`${month.month}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const rows = useMemo(() => month.projects.flatMap(project => project.rows), [month]);
  const distribution = useMemo(() => distributeBillingInvoice(rows, selected, amount), [rows, selected, amount]);
  const lineByKey = new Map(distribution.lines.map(line => [line.row.key, line]));
  const allocated = distribution.lines.reduce((sum, line) => sum + (line.cents || 0), 0);
  const hasAmount = distribution.invoiceCents !== null && !distribution.error;

  return <details className="rounded-xl border border-slate-200 bg-white" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer rounded-xl bg-slate-50 px-5 py-4 font-semibold"><span className="ml-2">{label}</span><span className="ml-4 text-sm font-normal text-slate-600">{month.projects.length} projects · {hours(month.totalHours)} hours</span></summary>
    {!month.projects.length ? <p className="p-6 text-sm text-slate-500">No subcontractor hours recorded for this month.</p> : <div className="space-y-5 p-4 md:p-5">
      <section aria-label={`Invoice worksheet for ${label}`} className="space-y-3 rounded-lg border border-teal-200 bg-teal-50 p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="grid gap-1 text-xs font-semibold">Invoice reference (optional)<input className={fieldClass} placeholder="Vendor / invoice number" value={reference} onChange={event => setReference(event.target.value)} /></label>
          <label className="grid gap-1 text-xs font-semibold">Invoice total (USD)<input className={fieldClass} inputMode="decimal" placeholder="0.00" value={amount} onChange={event => setAmount(event.target.value)} /></label>
          <button className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40" disabled={!hasAmount} onClick={() => downloadCsv(billingDistributionCsv(distribution, reference), `invoice-distribution-${month.month}.csv`)}>Export invoice distribution</button>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm"><strong>{selected.length} of {month.projects.length} projects included</strong><button className="text-teal-800 underline" onClick={() => setSelected(month.projects.map(project => project.projectId))}>Select all projects</button><button className="text-teal-800 underline" onClick={() => setSelected([])}>Clear selection</button><span className="text-slate-600">Use the checkboxes below to match the invoice.</span></div>
        {distribution.error ? <p role="status" className="text-sm font-medium text-amber-900">{distribution.error}</p> : <p aria-live="polite" className="text-sm text-teal-950">Allocation basis: <strong>{hours(distribution.totalHours)} hours</strong>{hasAmount && <> · Allocated: <strong>{dollars(allocated)}</strong> · Difference: <strong>{dollars(distribution.invoiceCents! - allocated)}</strong></>}</p>}
      </section>
      {month.projects.map(project => {
        const included = selected.includes(project.projectId);
        const projectLines = distribution.lines.filter(line => line.row.projectId === project.projectId);
        const projectCents = projectLines.reduce((sum, line) => sum + (line.cents || 0), 0);
        const invoiceShare = projectLines.reduce((sum, line) => sum + line.invoiceShare, 0);
        return <section key={project.projectId} className={`overflow-hidden rounded-lg border ${included ? 'border-slate-300' : 'border-slate-200'}`}>
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 px-4 py-3">
            <label className="flex items-center gap-3"><input className="h-4 w-4 accent-teal-700" type="checkbox" aria-label={`Include ${project.projectName} (${project.projectId}) in ${label} invoice`} checked={included} onChange={event => setSelected(previous => event.target.checked ? [...previous, project.projectId] : previous.filter(id => id !== project.projectId))} /><span><strong>{project.projectName}</strong><span className="block text-xs text-slate-500">{project.projectNumber || project.projectId}</span></span></label>
            <div className="text-right text-sm"><strong>{hours(project.totalHours)} hours</strong><span className="ml-4 text-slate-600">{included && !distribution.error ? `${percent(invoiceShare)} of invoice` : 'Not allocated'}</span>{hasAmount && included && <strong className="ml-4 text-teal-800">{dollars(projectCents)}</strong>}</div>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">{label} · {project.projectName} cost-code distribution</caption><thead className="border-b border-slate-200 text-xs text-slate-600"><tr>{['Cost code', 'Timesheet hours', 'Productivity hours', 'Combined hours', '% of project', '% of invoice', 'Allocated cost'].map((heading, index) => <th key={heading} scope="col" className={`px-3 py-3 ${index ? 'text-right' : ''}`}>{heading}</th>)}</tr></thead>
            <tbody>{project.rows.map(row => {
              const line = lineByKey.get(row.key);
              const projectShare = project.totalHours > 0 && project.rows.every(item => item.totalHours >= 0) ? row.totalHours / project.totalHours : null;
              return <Fragment key={row.key}><tr className="border-b border-slate-100"><td className="px-3 py-3"><button className="text-left font-semibold text-teal-800" aria-expanded={expanded === row.key} onClick={() => setExpanded(expanded === row.key ? null : row.key)}><span aria-hidden="true">{expanded === row.key ? '▾' : '▸'} </span>{row.costCode}<span className="block text-xs font-normal text-slate-500">{row.costCodeName}</span></button></td>
                <td className="px-3 py-3 text-right tabular-nums">{hours(row.timesheetHours)}</td><td className="px-3 py-3 text-right tabular-nums">{hours(row.productivityHours)}</td><td className="px-3 py-3 text-right font-semibold tabular-nums">{hours(row.totalHours)}</td><td className="px-3 py-3 text-right tabular-nums">{projectShare === null ? '—' : percent(projectShare)}</td><td className="px-3 py-3 text-right tabular-nums">{line ? percent(line.invoiceShare) : '—'}</td><td className="px-3 py-3 text-right font-bold tabular-nums text-teal-800">{line?.cents !== null && line?.cents !== undefined ? dollars(line.cents) : '—'}</td></tr>
                {expanded === row.key && <tr><td colSpan={7} className="bg-slate-50 p-4"><table className="w-full text-xs"><caption className="mb-3 text-left font-semibold">Source entries · {row.costCode}</caption><thead><tr>{['Date', 'Source', 'Description / notes', 'Status', 'Hours'].map(heading => <th scope="col" key={heading} className="border-b border-slate-200 p-2">{heading}</th>)}</tr></thead><tbody>{row.entries.map(entry => <tr key={`${entry.source}:${entry.id}`}><td className="whitespace-nowrap p-2">{entry.date}</td><td className="p-2">{entry.source === 'timesheet' ? 'Timesheet' : 'Productivity'}<span className="block text-slate-500">#{entry.id}</span></td><td className="p-2">{entry.description}{entry.notes && entry.notes !== entry.description && <span className="block text-slate-500">{entry.notes}</span>}{entry.source === 'productivity' && <span className="block text-slate-500">Recorded unit: {entry.uom || 'Not recorded'}</span>}</td><td className="p-2">{entry.status}</td><td className="p-2 text-right font-semibold tabular-nums">{hours(entry.hours)}</td></tr>)}</tbody></table></td></tr>}
              </Fragment>;
            })}</tbody>
          </table></div>
        </section>;
      })}
      <p className="text-xs text-slate-500">Allocated costs add to the invoice total exactly. Rounding cents go to the lines with the largest fractional remainders. This worksheet does not save or post a bill to QuickBooks.</p>
    </div>}
  </details>;
}

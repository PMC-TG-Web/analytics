'use client';
import { useState } from 'react';
import { hasEstimateVersions, type EstimatePreviewMonth, type EstimatePreviewReport } from '@/lib/kpiEstimatePreview';
import { useKpiReport } from './useKpiReport';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const emptyMonth = (): EstimatePreviewMonth => ({ count: 0, hours: 0, sales: 0, missingHours: 0, missingSales: 0, rebids: 0 });
const format = (value: number | null, dollars = false) => value === null ? 'Unavailable' : `${dollars ? '$' : ''}${value.toLocaleString('en-US', { maximumFractionDigits: dollars ? 0 : 1 })}`;
const cell = { padding: '7px 8px', textAlign: 'right' as const, borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' as const };
const monthLabel = (date: string) => new Date(`${date.slice(0, 7)}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const button = { background: 'none', border: 0, color: '#15616D', textDecoration: 'underline', cursor: 'pointer', padding: 0, font: 'inherit' };

export default function KpiEstimatePreview({ year }: { year: string }) {
  const [open, setOpen] = useState(false);
  return <section aria-label="Estimate calculation preview" style={{ marginBottom: 12, border: '1px solid #b5cfd2', borderRadius: 6, background: '#f7fbfb', padding: 10, fontSize: 12 }}>
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} style={{ ...button, fontWeight: 700 }}>
      {open ? 'Hide' : 'Review'} estimate calculation preview · local only
    </button>
    {open && <EstimatePreviewContents year={year} />}
  </section>;
}

export type EstimateSelection = { year: string; month: string | null } | null;
export type EstimateReportData = { report: EstimatePreviewReport | null; error: string; retry: () => void };

export function KpiEstimateDetails({ year, data, selection, onSelect }: { year: string; data: EstimateReportData; selection: EstimateSelection; onSelect: (value: EstimateSelection) => void }) {
  const [open, setOpen] = useState(false);
  const unresolved = data.report?.projects.filter(project => project.issues.length > 0) ?? [];
  return <section aria-label="Estimate calculations" style={{ marginBottom: 12, border: '1px solid #b5cfd2', borderRadius: 6, background: '#f7fbfb', padding: 10, fontSize: 12 }}>
    <button type="button" style={{ ...button, fontWeight: 700 }} onClick={() => { if (open || selection) { setOpen(false); onSelect(null); } else setOpen(true); }} aria-expanded={open || Boolean(selection)}>
      {open || selection ? 'Hide' : 'View'} estimate calculations
    </button>
    {!data.error && unresolved.length > 0 && <p style={{ color: '#854d0e', marginBottom: 0 }}>{unresolved.length} project{unresolved.length === 1 ? '' : 's'} with unresolved data: {unresolved.map(project => project.name).join('; ')}. <button type="button" style={button} onClick={() => setOpen(true)}>Show missing information</button></p>}
    {(open || selection) && <EstimateCalculationContents year={year} data={data} selection={selection} setSelection={onSelect} localOnly={false} />}
    {data.error && !(open || selection) && <p role="status">{data.error} <button type="button" onClick={data.retry} style={button}>Retry</button></p>}
  </section>;
}

function EstimatePreviewContents({ year }: { year: string }) {
  const data = useKpiReport<EstimatePreviewReport>('/api/kpi/estimate-preview');
  const [selection, setSelection] = useState<EstimateSelection>(null);
  return <EstimateCalculationContents year={year} data={data} selection={selection} setSelection={setSelection} localOnly />;
}

function EstimateCalculationContents({ year, data, selection, setSelection, localOnly }: { year: string; data: EstimateReportData; selection: EstimateSelection; setSelection: (value: EstimateSelection) => void; localOnly: boolean }) {
  const { report, error, retry } = data;
  const [showVersions, setShowVersions] = useState(false);
  if (error) return <p role="status">{error} <button type="button" style={button} onClick={retry}>Retry</button></p>;
  if (!report) return <p role="status">Loading saved estimates…</p>;
  const startMonth = report.startDate.slice(0, 7);
  const startLabel = new Date(`${report.startDate}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const years = year ? [year] : report.years;
  const versionProjects = report.projects.filter(hasEstimateVersions);
  const unresolved = report.projects.filter(project => project.issues.length > 0);
  const selected = selection && (!year || year === selection.year) ? selection : null;
  const projects = selected ? report.projects.flatMap(project => {
    const events = project.events.filter(event => event.date >= report.startDate && event.date.startsWith(selected.month ?? selected.year));
    return events.length ? [{ ...project, displayedEvents: events }] : [];
  }) : [];
  return <>
    <p style={{ margin: '10px 0 6px' }}><strong>New calculation starts {startLabel}.</strong> Earlier months keep their saved actuals in the table below. The calculation breakdown covers only months from this start date. The main table totals include saved earlier months.</p>
    <p style={{ margin: '10px 0 6px' }}>Includes projects currently Estimating/Estimated, Bid Submitted, Accepted, In Progress, or Complete. Each project counts once across customers. Hours include PM.</p>
    <p style={{ margin: '6px 0' }}>New projects contribute their full estimate in the Created Date month. When all estimate versions were updated in the same month, that month counts the full primary once. Across different months, the current primary contributes only the change from the original estimate, or the first estimate created if no original is identified, including rebids of projects created before {startLabel}. For example, 1,000 hours / $100,000 becoming 1,300 hours / $125,000 adds 300 hours / $25,000; reductions subtract from the rebid month. Intermediate revisions do not replace that baseline. Earlier months keep their saved actuals.</p>
    <p style={{ margin: '6px 0 10px', color: '#854d0e' }}><strong>{localOnly ? 'Local review.' : 'Calculation notes.'}</strong> Rebid months use the primary version’s source update date in Eastern time. Same-month versions use the primary automatically. Across months, the baseline is the identified original (Original Estimate, Base Estimate, or Baseline Estimate), otherwise the earliest source-created estimate. Missing or tied creation dates need attention only when no original is identified. Display order and local sync dates do not choose the baseline. Missing information is listed below. Edits within a single estimate cannot be measured without an earlier saved version. {localOnly ? 'Saved monthly figures below are unchanged.' : 'Calculated rows refresh from saved data every minute while visible and when you return to the tab.'}</p>
    {report.legacyLedger && report.legacyLedger.contributingProjects > 0 && <p style={{ margin: '6px 0 10px' }}><strong>Old-instance ledger {report.legacyLedger.source === 'local-preview' ? 'draft' : 'history'}:</strong> {report.legacyLedger.contributingProjects} distinct historical projects contribute from retained old bids. Migrated projects are excluded from this supplement. {report.legacyLedger.missingHours} historical projects still need estimated hours.{report.legacyLedger.source === 'local-preview' ? ' This draft has not been imported into the shared database.' : ''}</p>}
    {report.missingCreatedDates > 0 && <p role="status">{report.missingCreatedDates} source records have no usable Created Date or reviewed date; they cannot be assigned to a month.</p>}
    <div style={{ overflowX: 'auto' }}>
      <table aria-label="Estimates and rebid changes by month" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
        <thead><tr><th style={{ ...cell, textAlign: 'left' }}>{localOnly ? 'Preview' : 'Calculated contributions'}</th>{months.map(month => <th key={month} style={cell}>{month}</th>)}<th style={cell}>{localOnly ? 'Preview total' : 'Period total'}</th></tr></thead>
        <tbody>{years.flatMap(targetYear => {
          const keys = months.map((_, index) => `${targetYear}-${String(index + 1).padStart(2, '0')}`);
          const values = keys.map(key => key < startMonth ? emptyMonth() : report.months[key] ?? emptyMonth());
          const total = values.reduce((sum, value) => ({ count: 0, hours: sum.hours + value.hours, sales: sum.sales + value.sales, missingHours: sum.missingHours + value.missingHours, missingSales: sum.missingSales + value.missingSales, rebids: 0 }), emptyMonth());
          total.count = report.projects.filter(project => project.events.some(event => event.date >= report.startDate && event.date.startsWith(targetYear))).length;
          total.rebids = report.projects.filter(project => project.events.some(event => event.date >= report.startDate && event.date.startsWith(targetYear) && event.kind === 'rebid')).length;
          return (['sales', 'hours', 'count', 'rebids'] as const).map(metric => <tr key={`${targetYear}:${metric}`}>
            <th scope="row" style={{ ...cell, textAlign: 'left', fontWeight: 600 }}>{targetYear} {metric === 'sales' ? 'Bids Submitted $' : metric === 'hours' ? 'Hours incl. PM' : metric === 'count' ? 'Distinct projects' : 'Projects rebid'}</th>
            {[...values, total].map((value, index) => {
              if ((keys[index] ?? keys[11]) < startMonth) return <td key={index} style={{ ...cell, color: '#64748b' }} title={`Before ${startLabel}; use the saved actuals below.`}>—</td>;
              const missing = metric === 'sales' ? value.missingSales : metric === 'hours' ? value.missingHours : 0;
              return <td key={index} style={cell} title={missing ? `${missing} project(s) missing ${metric}; displayed amount is a partial total.` : undefined}>
                <button type="button" style={button} onClick={() => setSelection({ year: targetYear, month: keys[index] ?? null })}>
                  {missing ? 'Known ' : ''}{format(value[metric], metric === 'sales')}{missing ? '*' : ''}
                </button>
              </td>;
            })}
          </tr>);
        })}</tbody>
      </table>
    </div>
    <p style={{ margin: '6px 0' }}>* Known amounts are partial totals where a project has unavailable or conflicting data. Click an amount to inspect the original estimates and rebid changes. Project counts are distinct within each month and year.</p>
    {selected && <section aria-label="Estimate preview project breakdown" style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}><strong>Estimate contributions · {selected.month ?? (selected.year || 'All years')}</strong><button type="button" style={button} onClick={() => setSelection(null)}>Close breakdown</button></div>
      <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>{['Project / Created Date', 'Current status', 'Customer / sources', 'Contribution', 'Hours incl. PM', 'Bids Submitted $', 'Calculation / review'].map(label => <th key={label} style={cell}>{label}</th>)}</tr></thead>
        <tbody>{projects.map(project => <tr key={project.key}>
          <td style={{ ...cell, textAlign: 'left', whiteSpace: 'normal', minWidth: 180 }}>{project.name}<br /><span style={{ color: '#64748b' }}>{project.createdDate}</span></td>
          <td style={cell}>{project.status}</td>
          <td style={{ ...cell, whiteSpace: 'normal' }}>{project.customer || '—'}<br />{project.sourceCount} source{project.sourceCount === 1 ? '' : 's'}, counted once</td>
          <td style={cell}>{project.displayedEvents.map((event, index) => <div key={index}>{event.basis === 'same-month-primary' ? 'Primary estimate, counted once' : event.kind === 'rebid' ? 'Rebid change' : project.legacySource ? 'Historical estimate' : 'Initial estimate'} · {event.date}</div>)}</td>
          <td style={cell}>{project.displayedEvents.some(event => event.hours === null) ? 'Unavailable' : format(project.displayedEvents.reduce((sum, event) => sum + event.hours!, 0))}</td>
          <td style={cell}>{project.displayedEvents.some(event => event.sales === null) ? 'Unavailable' : format(project.displayedEvents.reduce((sum, event) => sum + event.sales!, 0), true)}</td>
          <td style={{ ...cell, whiteSpace: 'normal', minWidth: 220 }}>{project.displayedEvents.map((event, index) => <div key={index}>{event.basis === 'same-month-primary'
            ? `${event.revised?.name}: full primary counted once for ${monthLabel(event.date)}; other versions in that month are excluded.`
            : event.kind === 'rebid'
            ? `${event.basis === 'first-created-estimate' ? 'First-created baseline' : 'Original baseline'}: ${event.previous?.name} → ${event.revised?.name}: ${format(event.revised?.hours ?? null)} − ${format(event.previous?.hours ?? null)} hours; ${format(event.revised?.sales ?? null, true)} − ${format(event.previous?.sales ?? null, true)}`
            : event.revised?.name || project.legacySource || ''}</div>)}{project.issues.join(' ')}</td>
        </tr>)}</tbody>
      </table></div>
      {!projects.length && <p>No qualifying estimate contributions in this period.</p>}
    </section>}
    {unresolved.length > 0 && <section aria-label="Unresolved estimate data" style={{ marginTop: 12 }}>
      <strong>Missing information</strong>
      <ul>{unresolved.map(project => <li key={project.key}><strong>{project.name}:</strong> {project.issues.join(' ')} {project.events.some(event => event.date >= report.startDate) ? 'Available amounts are included; missing amounts remain unavailable.' : 'This project contributes no hours or dollars to the new calculation until its history is resolved.'}</li>)}</ul>
    </section>}
    <div style={{ marginTop: 12 }}>
      <button type="button" style={button} aria-expanded={showVersions} onClick={() => setShowVersions(value => !value)}>Estimate version details ({versionProjects.length} project{versionProjects.length === 1 ? '' : 's'})</button>
      {showVersions && <section aria-label="Possible rebids">
        <p>These are the source versions behind the calculation, across all years. Same-month versions count the primary once automatically. Across months, the primary is compared with the original or first-created estimate; intermediate revisions are ignored. Any unresolved projects are named in Missing information above.</p>
        {versionProjects.map(project => <details key={project.key} style={{ padding: '6px 0', borderTop: '1px solid #d5e1e3' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{project.name} · {project.proposals.length} estimate versions</summary>
          <p>{project.events.some(event => event.date >= report.startDate && event.basis === 'same-month-primary') ? 'Calculated automatically: the full primary is counted once for the month; other same-month versions are excluded.' : project.events.some(event => event.date >= report.startDate && event.kind === 'rebid') ? 'Rebid change included: primary minus the original estimate, or the first-created estimate when no original is identified.' : project.issues.join(' ') || 'No supported rebid comparison.'}</p>
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>{['Estimate / order', 'Primary', 'Comparison baseline', 'Source created (UTC)', 'Source last updated (UTC)', 'Hours incl. PM', 'Proposal $'].map(label => <th key={label} style={cell}>{label}</th>)}</tr></thead>
            <tbody>{project.proposals.map(proposal => {
              const baseline = proposal.bidBoardId === project.bidBoardId
                ? project.events.find(event => event.previous?.proposalId === proposal.proposalId)?.basis : undefined;
              return <tr key={`${proposal.bidBoardId}:${proposal.proposalId}`}>
              <td style={{ ...cell, textAlign: 'left', whiteSpace: 'normal' }}>{proposal.name}<br /><span style={{ color: '#64748b' }}>Order {proposal.order ?? 'unavailable'}{proposal.alternate ? ' · Alternate' : ''}</span></td><td style={cell}>{proposal.primary ? 'Yes' : '—'}</td>
              <td style={cell}>{baseline === 'original-estimate' ? 'Original estimate' : baseline === 'first-created-estimate' ? 'First created' : '—'}</td>
              <td style={cell}>{proposal.sourceCreatedAt?.slice(0, 10) || 'Unavailable'}</td><td style={cell}>{proposal.updatedAt?.slice(0, 10) || 'Unavailable'}</td><td style={cell}>{format(proposal.hours)}</td><td style={cell}>{format(proposal.sales, true)}</td>
            </tr>; })}</tbody>
          </table></div>
        </details>)}
        {!versionProjects.length && <p>No separate estimate versions found. This does not rule out edits to existing estimates.</p>}
      </section>}
    </div>
  </>;
}

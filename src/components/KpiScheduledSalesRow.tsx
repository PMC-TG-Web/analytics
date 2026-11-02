'use client';
import { useKpiReport } from './useKpiReport';
import type { WipScheduledSales } from '@/lib/wipScheduledSales';

export function useWipScheduledSales() {
  return useKpiReport<WipScheduledSales>('/api/kpi/scheduled-sales');
}

export default function KpiScheduledSalesRow({ months, data, onDetails }: {
  months: { year: string; month: number }[];
  data: ReturnType<typeof useWipScheduledSales>;
  onDetails: (year: string | null, month: number | null) => void;
}) {
  const { report, error, retry } = data;
  const values = months.map(({ year, month }) => report?.months[`${year}-${String(month).padStart(2, '0')}`] || 0);
  const format = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  const buttonStyle = { background: 'transparent', border: 'none', color: '#15616D', cursor: 'pointer', fontWeight: 700, fontSize: 12, textDecoration: 'underline', padding: 0 };
  const total = values.reduce((sum, value) => sum + value, 0);
  return <><tr aria-label="Scheduled" style={{ borderBottom: '1px solid #eee', backgroundColor: '#fff' }}>
    <th scope="row" title="Full project sales value × saved WIP monthly percentage" style={{ padding: '4px 6px', textAlign: 'left', color: '#15616D', fontWeight: 700, fontSize: 13 }}>Scheduled<span style={{ display: 'block', fontSize: 10, fontWeight: 400 }}>From WIP</span></th>
    {error ? <td colSpan={months.length + 1} role="status" style={{ padding: 6, fontSize: 12 }}>{error} <button onClick={retry} style={{ textDecoration: 'underline' }}>Retry</button></td>
      : !report ? <td colSpan={months.length + 1} role="status" style={{ padding: 6, fontSize: 12 }}>Loading WIP revenue…</td>
        : <>{values.map((value, index) => <td key={`${months[index].year}-${months[index].month}`} title={`WIP revenue · ${months[index].year}-${String(months[index].month).padStart(2, '0')}`} style={{ padding: '4px 2px', textAlign: 'center', color: '#999', fontSize: 12 }}>{value ? <button style={buttonStyle} onClick={() => onDetails(months[index].year, months[index].month)}>{format(value)}</button> : format(0)}</td>)}
          <td title="Total scheduled revenue for the displayed months" style={{ padding: '4px 6px', textAlign: 'center', color: '#15616D', fontWeight: 700, fontSize: 12, borderLeft: '2px solid #ddd' }}>{total ? <button style={buttonStyle} onClick={() => onDetails(new Set(months.map(item => item.year)).size === 1 ? months[0].year : null, null)}>{format(total)}</button> : format(0)}</td></>}
  </tr>
    {report && !error && <tr><td colSpan={months.length + 2} style={{ padding: '4px 6px', borderBottom: '1px solid #eee', backgroundColor: '#f8faf9' }}>
      {report.unscheduledProjects ? <details>
        <summary style={{ cursor: 'pointer', color: '#15616D', fontWeight: 600, fontSize: 12 }}>Not scheduled ({report.unscheduledProjects.length} {report.unscheduledProjects.length === 1 ? 'project' : 'projects'})</summary>
        <section aria-label="Projects not scheduled" style={{ padding: '8px 0', fontSize: 12 }}>
          <p style={{ margin: '0 0 8px', color: '#666' }}>Current In Progress projects without a saved WIP allocation, across all years. Save each allocation at 100% in WIP to include it in scheduled totals.</p>
          {report.unscheduledProjects.length ? <div style={{ maxHeight: 320, overflow: 'auto' }}><table style={{ width: '100%', textAlign: 'left' }}>
            <thead><tr><th style={{ padding: 5 }}>Project</th><th style={{ padding: 5 }}>Customer</th><th style={{ padding: 5, textAlign: 'right' }}>Hours excl. PM</th><th style={{ padding: 5 }}>Status</th></tr></thead>
            <tbody>{report.unscheduledProjects.map(project => <tr key={project.id} style={{ borderTop: '1px solid #ddd' }}>
              <td style={{ padding: 5, fontWeight: 600 }}>{project.projectName}{project.projectNumber && <span style={{ display: 'block', fontWeight: 400, color: '#666' }}>{project.projectNumber}</span>}</td>
              <td style={{ padding: 5 }}>{project.customer || '—'}</td>
              <td style={{ padding: 5, textAlign: 'right' }}>{project.hours === null ? '—' : project.hours.toLocaleString('en-US', { maximumFractionDigits: 1 })}</td>
              <td style={{ padding: 5 }}>{project.status}<span style={{ display: 'block', color: '#666', fontSize: 11 }}>{project.reason}</span></td>
            </tr>)}</tbody>
          </table></div> : <p>All current In Progress projects have saved WIP allocations.</p>}
          <a href="/wip" style={{ display: 'inline-block', marginTop: 8, color: '#15616D', textDecoration: 'underline', fontWeight: 600 }}>Open WIP</a>
        </section>
      </details> : <p role="status" style={{ fontSize: 12 }}>The not scheduled list is unavailable. <button type="button" onClick={retry}>Retry</button></p>}
    </td></tr>}
  </>;
}

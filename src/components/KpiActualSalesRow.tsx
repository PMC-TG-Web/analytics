'use client';
import { useState } from 'react';
import { useKpiReport } from './useKpiReport';
import type { KpiActualSales } from '@/lib/kpiActualSales';

export function useKpiActualSales() {
  return useKpiReport<KpiActualSales>('/api/kpi/actual-sales');
}
const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

type ActualSalesProps = { year: string; data: ReturnType<typeof useKpiActualSales> };

export default function KpiActualSalesRow(props: ActualSalesProps) {
  return <ActualSalesRow key={props.year} {...props} />;
}

function ActualSalesRow({ year, data }: ActualSalesProps) {
  const { report, error, retry } = data;
  const [detail, setDetail] = useState<number | 'total' | 'excluded' | null>(null);
  const values = monthNames.map((_, index) => report?.months[`${year}-${String(index + 1).padStart(2, '0')}`] || 0);
  const buttonStyle = { color: 'inherit', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 700, fontSize: 12, textDecoration: 'underline' };
  const projects = report?.projects.filter(project => project.contractDate.startsWith(`${year}-`) && (detail === 'total' || Number(project.contractDate.slice(5, 7)) === detail)) || [];
  return <>
    <tr aria-label="Actual Sales" style={{ borderBottom: '1px solid #eee', backgroundColor: '#fff' }}>
      <th scope="row" style={{ padding: '6px', textAlign: 'left', color: '#15616D', fontSize: 13 }} title="Full project sales value in the Financial WIP Contract Date month">Actual Sales
        <span style={{ display: 'block', fontSize: 10, fontWeight: 400 }}>By Contract Date</span>
        {!error && !!report?.excluded.length && <button type="button" onClick={() => setDetail('excluded')} style={{ ...buttonStyle, display: 'block', color: '#a33', fontSize: 10 }}>{report.excluded.length} need review</button>}
      </th>
      {error ? <td colSpan={13} role="status" style={{ padding: 6, fontSize: 12 }}>{error} <button type="button" onClick={retry}>Retry</button></td>
        : !report ? <td colSpan={13} role="status" style={{ padding: 6, fontSize: 12 }}>Loading actual sales…</td>
          : <>{values.map((value, index) => <td key={index} title={`Contract sales · ${year}-${String(index + 1).padStart(2, '0')}`} style={{ padding: '6px 2px', textAlign: 'center', color: value ? '#15616D' : '#999', fontSize: 12 }}><button type="button" style={buttonStyle} onClick={() => setDetail(index + 1)}>{money(value)}</button></td>)}
            <td title="Total actual sales for this year" style={{ padding: 6, textAlign: 'center', borderLeft: '2px solid #ddd', color: '#15616D' }}><button type="button" style={buttonStyle} onClick={() => setDetail('total')}>{money(values.reduce((a, b) => a + b, 0))}</button></td></>}
    </tr>
    {detail !== null && report && !error && <tr><td colSpan={14}>
      <section aria-label="Actual sales project breakdown" style={{ padding: 12, background: '#f8faf9', fontSize: 12 }}>
        <button type="button" onClick={() => setDetail(null)} style={{ float: 'right', textDecoration: 'underline' }}>Close breakdown</button>
        <strong>{detail === 'excluded' ? 'Actual Sales · Projects needing review' : `Actual Sales · ${year} · ${detail === 'total' ? 'Total' : monthNames[detail - 1]}`}</strong>
        <p style={{ margin: '6px 0' }}>Uses Project → Additional Information → Contract Date, the same source as Financial WIP. Full Bid Board/estimate sales value counts once in that month. Accepted projects are included.</p>
        {detail === 'excluded' ? <><p>These projects are excluded from totals. Missing dates cannot be assigned to a year; this review list includes all years.</p><ul>{report.excluded.map((project, index) => <li key={`${project.projectId}-${index}`}>{project.projectName}: {project.reason}</li>)}</ul></>
          : <div style={{ maxHeight: 320, overflow: 'auto' }}><table style={{ width: '100%', textAlign: 'left' }}>
            <thead><tr><th>Project</th><th>Customer</th><th>Contract Date</th><th style={{ textAlign: 'right' }}>Sales value</th></tr></thead>
            <tbody>{projects.map(project => <tr key={project.projectId} style={{ borderBottom: '1px solid #ddd' }}><td style={{ padding: 5 }}>{project.projectName}</td><td>{project.customer}</td><td>{project.contractDate}</td><td style={{ textAlign: 'right' }}>{money(project.value)}</td></tr>)}</tbody>
          </table>{projects.length === 0 && <p>No contract sales in this period.</p>}</div>}
      </section>
    </td></tr>}
  </>;
}

'use client';
import { useState } from 'react';
import type { useKpiActualSales } from './KpiActualSalesRow';

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const formatHours = (value: number | null) => value === null ? 'Needs review' : value.toLocaleString('en-US', { maximumFractionDigits: 1 });
type Props = { year: string; data: ReturnType<typeof useKpiActualSales> };
const buttonStyle = { color: 'inherit', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 700, fontSize: 12, textDecoration: 'underline' };

export default function KpiActualHoursRow(props: Props) {
  return <ActualHoursRow key={props.year} {...props} />;
}

function ActualHoursRow({ year, data }: Props) {
  const { report, error, retry } = data;
  const [detail, setDetail] = useState<number | 'total' | null>(null);
  const hoursReport = report?.hours;
  const values = monthNames.map((_, index) => {
    const value = hoursReport?.months[`${year}-${String(index + 1).padStart(2, '0')}`];
    return value === undefined ? 0 : value;
  });
  const total = values.some(value => value === null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const projects = hoursReport?.projects.filter(project => project.contractDate.startsWith(`${year}-`)
    && (detail === 'total' || Number(project.contractDate.slice(5, 7)) === detail)) || [];
  const unavailable = error || (report && !hoursReport ? 'Actual hours are unavailable. Please retry.' : null);
  return <>
    <tr aria-label="Actual Hours" style={{ borderBottom: '1px solid #eee', backgroundColor: '#fff' }}>
      <th scope="row" style={{ padding: 6, textAlign: 'left', color: '#E06C00', fontSize: 13 }} title="Estimated hours excluding PM for the same projects and Contract Date months as Actual Sales">Actual Hours
        <span style={{ display: 'block', fontSize: 10, fontWeight: 400 }}>Sold estimate · excl. PM</span>
      </th>
      {unavailable ? <td colSpan={13} role="status" style={{ padding: 6, fontSize: 12 }}>{unavailable} <button type="button" onClick={retry}>Retry</button></td>
        : !hoursReport ? <td colSpan={13} role="status" style={{ padding: 6, fontSize: 12 }}>Loading actual hours…</td>
          : <>{values.map((value, index) => <td key={index} title={`Sold estimate hours excluding PM · ${year}-${String(index + 1).padStart(2, '0')}`} style={{ padding: '6px 2px', textAlign: 'center', color: value === null ? '#a33' : value ? '#E06C00' : '#999', fontSize: 12 }}><button type="button" style={buttonStyle} onClick={() => setDetail(index + 1)}>{formatHours(value)}</button></td>)}
            <td title="Total actual hours for this year" style={{ padding: 6, textAlign: 'center', borderLeft: '2px solid #ddd', color: total === null ? '#a33' : '#E06C00' }}><button type="button" style={buttonStyle} onClick={() => setDetail('total')}>{formatHours(total)}</button></td></>}
    </tr>
    {detail !== null && hoursReport && !unavailable && <tr><td colSpan={14}>
      <section aria-label="Actual hours project breakdown" style={{ padding: 12, background: '#f8faf9', fontSize: 12 }}>
        <button type="button" onClick={() => setDetail(null)} style={{ float: 'right', textDecoration: 'underline' }}>Close breakdown</button>
        <strong>Actual Hours · {year} · {detail === 'total' ? 'Total' : monthNames[detail - 1]}</strong>
        <p style={{ margin: '6px 0' }}>Uses the same projects and Contract Dates as Actual Sales. Each selected estimate contributes its full hours minus Project Management, using the WIP hours basis. These are hours sold, not hours worked or monthly WIP allocations.</p>
        {projects.some(project => project.issue) && <p style={{ color: '#a33' }}>Missing or invalid estimate hours must be resolved before this period can show a complete total.</p>}
        <div style={{ maxHeight: 320, overflow: 'auto' }}><table style={{ width: '100%', textAlign: 'left' }}>
          <thead><tr><th>Project</th><th>Contract Date</th><th style={{ textAlign: 'right' }}>Estimated hours</th><th style={{ textAlign: 'right' }}>PM hours</th><th style={{ textAlign: 'right' }}>Hours excl. PM</th></tr></thead>
          <tbody>{projects.map(project => <tr key={project.projectId} style={{ borderBottom: '1px solid #ddd' }}><td style={{ padding: 5 }}>{project.projectName}{project.issue && <p style={{ color: '#a33' }}>{project.issue}</p>}</td><td>{project.contractDate}</td><td style={{ textAlign: 'right' }}>{project.issue ? '—' : formatHours(project.estimatedHours)}</td><td style={{ textAlign: 'right' }}>{project.issue ? '—' : formatHours(project.projectManagementHours)}</td><td style={{ textAlign: 'right' }}>{formatHours(project.hours)}</td></tr>)}</tbody>
        </table>{projects.length === 0 && <p>No contract sales in this period.</p>}</div>
      </section>
    </td></tr>}
  </>;
}

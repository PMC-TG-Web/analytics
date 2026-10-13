'use client';
import { useKpiReport } from './useKpiReport';
import type { WipScheduledHours } from '@/lib/wipScheduledHours';

export function useWipScheduledHours() {
  return useKpiReport<WipScheduledHours>('/api/kpi/scheduled-hours');
}

export default function KpiScheduledHoursRow({ months, data }: {
  months: { year: string; month: number }[];
  data: ReturnType<typeof useWipScheduledHours>;
}) {
  const { report, error, retry } = data;
  const values = months.map(({ year, month }) => report?.months[`${year}-${String(month).padStart(2, '0')}`] || 0);
  const format = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return <tr aria-label="Scheduled Hours" style={{ borderBottom: '1px solid #eee', backgroundColor: '#ffffff' }}>
    <th scope="row" title="Saved WIP estimated hours excluding Project Management. Update percentages in WIP." style={{ padding: '4px 6px', textAlign: 'left', color: '#15616D', fontWeight: 700, fontSize: 13 }}>Scheduled Hours<span style={{ display: 'block', fontSize: 10, fontWeight: 400 }}>From WIP</span></th>
    {error ? <td colSpan={months.length + 1} role="status" style={{ padding: 6, fontSize: 12 }}>{error} <button onClick={retry} style={{ textDecoration: 'underline' }}>Retry</button></td>
      : !report ? <td colSpan={months.length + 1} role="status" style={{ padding: 6, fontSize: 12 }}>Loading WIP hours…</td>
        : <>{values.map((value, index) => <td key={`${months[index].year}-${months[index].month}`} title={`Saved WIP · ${months[index].year}-${String(months[index].month).padStart(2, '0')}`} style={{ padding: '4px 2px', textAlign: 'center', color: value ? '#15616D' : '#999', fontWeight: value ? 700 : 400, fontSize: 12 }}>{format(value)}</td>)}
          <td title="Total saved WIP hours for the displayed months" style={{ padding: '4px 6px', textAlign: 'center', color: '#15616D', fontWeight: 700, fontSize: 12, borderLeft: '2px solid #ddd' }}>{format(values.reduce((sum, value) => sum + value, 0))}</td></>}
  </tr>;
}

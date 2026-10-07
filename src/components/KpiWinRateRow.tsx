'use client';

import { useEffect, useState } from 'react';
import type { WinRateCount, WinRateReport } from '@/lib/kpiWinRate';

const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function KpiWinRateRow({ year }: { year: string }) {
  const [report, setReport] = useState<WinRateReport | null>(null);
  const [error, setError] = useState('');
  const [baselineSavedAt, setBaselineSavedAt] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [detail, setDetail] = useState<number | 'total' | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setReport(null); setError(''); setDetail(null);
    async function load() {
      try {
        const response = await fetch(`/api/kpi/win-rate${year ? `?year=${encodeURIComponent(year)}` : ''}`, { cache: 'no-store', credentials: 'include', signal: controller.signal });
        const body = await response.json();
        if (!response.ok || !body.success) throw new Error(body.error || 'Could not load win rate.');
        setReport(body.data);
        setBaselineSavedAt(body.baselineSavedAt ?? null);
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load win rate.');
      }
    }
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => { controller.abort(); window.removeEventListener('focus', refresh); window.clearInterval(timer); };
  }, [year, retry]);
  function cell(value: WinRateCount | null | undefined, month: number | 'total') {
    return <td key={month} style={{ padding: month === 'total' ? '6px 6px' : '6px 2px', textAlign: 'center', fontSize: 12, color: value?.rate == null ? '#999' : '#15616D', fontWeight: value?.rate == null ? 400 : 700, borderLeft: month === 'total' ? '2px solid #ddd' : undefined }}>
      {value ? <button type="button" onClick={() => setDetail(month)} title="View projects" style={{ color: 'inherit', font: 'inherit', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
        {value.rate === null ? '—' : `${(value.rate * 100).toFixed(2)}%`}
      </button> : '—'}
    </td>;
  }
  const visibleProjects = report?.projects.filter(p => detail === 'total' || (typeof detail === 'number' && Number(p.createdDate.slice(5, 7)) <= detail)) ?? [];
  return <>
    <tr style={{ borderBottom: '1px solid #eee', backgroundColor: '#ffffff' }}>
      <th scope="row" style={{ padding: '6px 6px', textAlign: 'left', color: '#15616D', fontWeight: 700, fontSize: 13 }}>
        Rolling Win Rate
      </th>
      {error ? <td colSpan={13} role="status" style={{ padding: 6, fontSize: 12 }}>{error} <button type="button" onClick={() => setRetry(n => n + 1)} style={{ textDecoration: 'underline' }}>Retry</button></td>
        : !report ? <td colSpan={13} role="status" style={{ padding: 6, fontSize: 12 }}>Loading win rate…</td>
          : <>{report.months.map((value, i) => cell(value, i + 1))}{cell(report.total, 'total')}</>}
    </tr>
    {report && report.missingCreatedDates > 0 && <tr><td colSpan={14} style={{ color: '#a33', padding: 6 }}>{report.missingCreatedDates} projects lack a Created Date and are excluded.</td></tr>}
    {detail !== null && report && <tr><td colSpan={14}>
      <section aria-label="Win rate project breakdown" style={{ padding: 12, background: '#f8faf9' }}>
        <button type="button" onClick={() => setDetail(null)} style={{ float: 'right', textDecoration: 'underline' }}>Close breakdown</button>
        <strong>Win rate · {year || 'All years'}{detail !== 'total' ? ` · Jan–${monthNames[detail - 1]}` : ' · Total'}</strong>
        <p style={{ margin: '6px 0', fontSize: 12 }}>Reporting starts January 2026. Projects created before 2026 are excluded, including their migration copies.</p>
        <p style={{ margin: '6px 0', fontSize: 12 }}>Accepted, In Progress, and Complete count as won. Estimating is excluded from jobs bid. Projects are grouped by Created Date and counted once across saved history and current projects, regardless of contractor. Monthly values accumulate through each month; Total divides total wins by total jobs bid.</p>
        {baselineSavedAt && <p style={{ margin: '6px 0', fontSize: 12 }}>Old-instance history saved {new Date(baselineSavedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' })}. Current-instance statuses update automatically. The old instance is no longer needed.</p>}
        {!year && <p style={{ fontSize: 12 }}>All years combines January through the selected month from every year.</p>}
        <div style={{ maxHeight: 360, overflow: 'auto' }}><table style={{ width: '100%', fontSize: 12, textAlign: 'left' }}>
          <thead><tr><th>Project</th><th>Created</th><th>Status</th><th>Won</th><th>Jobs bid</th><th>Source bids</th></tr></thead>
          <tbody>{visibleProjects.map(p => <tr key={p.key} style={{ borderBottom: '1px solid #ddd' }}><td style={{ padding: 5 }}>{p.name}</td><td>{p.createdDate.slice(0, 10)}</td><td>{p.status}</td><td>{p.won ? '1' : '0'}</td><td>{p.bid ? '1' : 'Excluded: Estimating'}</td><td title={p.sources.map(s => `${s.companyId} / ${s.bidBoardId}: ${s.status}`).join('\n')}>{p.sources.length}</td></tr>)}</tbody>
        </table></div>
      </section>
    </td></tr>}
  </>;
}

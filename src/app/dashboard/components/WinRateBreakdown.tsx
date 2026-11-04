"use client";

import { dashboardProjectDateKey } from "@/lib/estimatingDashboardDates";
import type { DashboardWinRate, DashboardWinRateHistory } from "@/lib/dashboardWinRate";

type Props = {
  kind: 'won' | 'bid' | 'missing';
  report: DashboardWinRate;
  history: DashboardWinRateHistory;
  startDate: string;
  endDate: string;
  onClose: () => void;
};

export function WinRateBreakdown({ kind, report, history, startDate, endDate, onClose }: Props) {
  const ids = new Set(kind === 'won' ? report.wonIds : kind === 'bid' ? report.bidIds
    : [...report.missingWonDateIds, ...report.missingBidDateIds]);
  const rows = history.projects.filter(project => ids.has(project.id));
  const label = kind === 'won' ? 'Won' : kind === 'bid' ? 'Bid' : 'Dates needing review';
  const period = startDate || endDate ? `${startDate || 'start'} through ${endDate || 'no end date'}` : 'All dates';
  return <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4" onClick={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section role="dialog" aria-modal="true" aria-labelledby="win-rate-breakdown-title" className="max-h-[85vh] w-full max-w-5xl overflow-auto rounded-xl bg-white p-6 shadow-2xl">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 id="win-rate-breakdown-title" className="text-xl font-bold text-teal-800">Win Rate - {label} ({period})</h2>
        <button type="button" onClick={onClose} aria-label="Close win-rate breakdown" className="font-bold underline">Close</button>
      </div>
      <p className="mb-3 text-xs text-gray-600">
        {rows.length} reporting projects. Saved old-instance history and current bids share approved original dates; contractor duplicates and migration copies count once.
        {' '}Won counts use eligible current projects with linked Contract Dates. Historical bid rows do not invent missing sales, hours, or award dates.
      </p>
      <table className="w-full text-left text-sm">
        <thead><tr><th className="p-2">Project</th><th className="p-2">Status</th><th className="p-2">Original bid Created Date</th><th className="p-2">Contract Date</th><th className="p-2">Bid source</th></tr></thead>
        <tbody>{rows.map(project => <tr key={project.id} className="border-t border-gray-200">
          <td className="p-2">{project.projectName}</td>
          <td className="p-2">{project.status}</td>
          <td className="p-2">{dashboardProjectDateKey({ dateCreated: project.dateCreated }) || 'Missing date'}</td>
          <td className="p-2">{project.contractDate || (project.won ? 'Needs review' : 'Not used for this bid')}{project.contractDateIssue && <span className="block text-xs text-orange-700">{project.contractDateIssue}</span>}</td>
          <td className="p-2">{project.hasSavedHistory ? project.hasCurrentRecord ? 'Saved history + current' : 'Saved history' : 'Current'}</td>
        </tr>)}</tbody>
      </table>
      {!rows.length && <p className="py-4 text-gray-500">No matching projects.</p>}
    </section>
  </div>;
}

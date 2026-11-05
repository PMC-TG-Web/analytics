import { classifyUsageRecord, latestUsageRecords, usagePeriod, type UsagePeriod, type UsageProject, type UsageRecord } from './projectUsageReport.ts';

export type HourEntry = {
  key: string; sourceId: string; projectId: string; projectName: string; projectNumber: string;
  source: 'Timecard' | 'Productivity'; date: string; description: string; logDescription: string;
  notes: string; worker: string; costCode: string; status: string; hours: number | null;
  quantity: number | null; unit: string; laborType: string; note: string;
};
export type HoursReport = UsagePeriod & {
  companyId: string; loadedAt: string; latestMirrorUpdate: string | null;
  entries: HourEntry[]; review: HourEntry[];
  excluded: { deleted: number; billingLogs: number; nonLabor: number };
};
export type HoursFilters = { description: string; projectId: string; source: string };
export const emptyHoursFilters: HoursFilters = { description: '', projectId: '', source: '' };
const round = (value: number) => Math.round((value + Number.EPSILON) * 10_000) / 10_000;

export function buildHoursReport(companyId: string, period: UsagePeriod, projects: UsageProject[], records: UsageRecord[]): HoursReport {
  usagePeriod(period.from, period.through);
  const report: HoursReport = { ...period, companyId, loadedAt: new Date().toISOString(), latestMirrorUpdate: null,
    entries: [], review: [], excluded: { deleted: 0, billingLogs: 0, nonLabor: 0 } };
  const byId = new Map(projects.map(project => [project.procoreProjectId, project]));
  for (const row of latestUsageRecords(companyId, records)) {
    // Deduplicate before filtering: moved or deleted sources must not revive old copies.
    if ((period.from && row.date < period.from) || (period.through && row.date > period.through)) continue;
    if (row.deletedAt || /^(deleted|void|voided)$/i.test(row.status?.trim() || '')) { report.excluded.deleted++; continue; }
    if (row.source === 'Daily log' && /billing file/i.test(row.holderTitle || '')) { report.excluded.billingLogs++; continue; }
    const update = new Date(row.updatedAt).toISOString();
    if (!report.latestMirrorUpdate || update > report.latestMirrorUpdate) report.latestMirrorUpdate = update;
    const classification = classifyUsageRecord(row);
    if (classification.kind !== 'labor' && classification.kind !== 'review') { report.excluded.nonLabor++; continue; }
    const project = byId.get(row.projectId || '');
    const quantity = row.quantity != null && Number.isFinite(row.quantity) ? row.quantity : null;
    const entry: HourEntry = {
      key: JSON.stringify([companyId, row.projectId, row.source, row.sourceId || `local:${row.id}`]),
      sourceId: row.sourceId || row.id, projectId: row.projectId || '',
      projectName: project?.projectName || (row.projectId ? `Project ${row.projectId}` : 'Missing project ID'),
      projectNumber: project?.projectNumber || '', source: row.source === 'Timecard' ? 'Timecard' : 'Productivity',
      date: row.date, description: row.description?.trim() || '', logDescription: row.logDescription?.trim() || '',
      notes: row.notes?.trim() || '', worker: row.worker?.trim() || '', costCode: row.costCode?.trim() || '',
      status: row.status?.trim() || 'Not recorded', hours: classification.kind === 'labor' ? quantity : null,
      quantity, unit: row.uom || '', laborType: classification.subcontractor ? 'Subcontractor' : 'Field labor', note: classification.note,
    };
    report[classification.kind === 'labor' ? 'entries' : 'review'].push(entry);
  }
  const compare = (a: HourEntry, b: HourEntry) => b.date.localeCompare(a.date) || a.projectName.localeCompare(b.projectName)
    || a.source.localeCompare(b.source) || a.key.localeCompare(b.key);
  report.entries.sort(compare); report.review.sort(compare);
  return report;
}

export function filterHourEntries(entries: HourEntry[], filters: HoursFilters): HourEntry[] {
  const description = filters.description.trim().normalize('NFKC').toLowerCase();
  return entries.filter(row => (!filters.projectId || row.projectId === filters.projectId)
    && (!filters.source || row.source === filters.source)
    && (!description || [row.description, row.logDescription, row.notes].some(value => value.normalize('NFKC').toLowerCase().includes(description))));
}

export function hoursTotals(entries: HourEntry[]) {
  const timecard = round(entries.filter(row => row.source === 'Timecard').reduce((sum, row) => sum + (row.hours || 0), 0));
  const productivity = round(entries.filter(row => row.source === 'Productivity').reduce((sum, row) => sum + (row.hours || 0), 0));
  return { timecard, productivity, combined: round(timecard + productivity), count: entries.length };
}

/** Export all matching rows, independent of the visible table page. */
export function hoursReportCsv(entries: HourEntry[]) {
  const cell = (value: string | number | null) => {
    const safe = typeof value === 'string' && /^\s*[=+\-@\t\r]/.test(value) ? `'${value}` : value ?? '';
    return `"${String(safe).replaceAll('"', '""')}"`;
  };
  return [['Work date', 'Source', 'Project', 'Project number', 'Project ID', 'Description', 'Daily-log description', 'Notes', 'Worker', 'Cost code', 'Hours', 'Status', 'Labor type', 'Source ID', 'Recorded quantity', 'Recorded unit', 'Review / classification note'],
    ...entries.map(row => [row.date, row.source, row.projectName, row.projectNumber, row.projectId, row.description,
      row.logDescription, row.notes, row.worker, row.costCode, row.hours, row.status, row.laborType, row.sourceId, row.quantity, row.unit, row.note])]
    .map(row => row.map(cell).join(',')).join('\r\n');
}

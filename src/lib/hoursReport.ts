import { classifyUsageRecord, latestUsageRecords, usagePeriod, type UsagePeriod, type UsageProject, type UsageRecord } from './projectUsageReport.ts';

export type HourEntry = {
  key: string; sourceId: string; projectId: string; projectName: string; projectNumber: string;
  source: 'Timecard' | 'Productivity'; date: string; description: string; logDescription: string;
  notes: string; worker: string; costCode: string; status: string; hours: number | null;
  billable: boolean | null;
  costCodeDescription: string;
  quantity: number | null; unit: string; laborType: string; note: string;
};
export type HoursReport = UsagePeriod & {
  companyId: string; loadedAt: string; latestMirrorUpdate: string | null;
  entries: HourEntry[]; review: HourEntry[];
  excluded: { deleted: number; billingLogs: number; nonLabor: number };
};
export type HoursTextMatch = 'contains' | 'not-contains';
export type HoursFilters = {
  description: string; projectId: string; source: string; from: string; through: string;
  subcontractor: '' | 'exclude' | 'only';
  billable: '' | 'billable' | 'not-billable' | 'not-recorded';
  worker: string; costCode: string; minHours: string; maxHours: string; status: string;
  descriptionMatch: HoursTextMatch; workerMatch: HoursTextMatch; costCodeMatch: HoursTextMatch; statusMatch: HoursTextMatch;
};
export const emptyHoursFilters: HoursFilters = {
  description: '', projectId: '', source: '', from: '', through: '', worker: '', costCode: '', minHours: '', maxHours: '', status: '',
  subcontractor: '', billable: '',
  descriptionMatch: 'contains', workerMatch: 'contains', costCodeMatch: 'contains', statusMatch: 'contains',
};
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
      // Billing Analytics shows the entered timecard description, falling back to
      // the Sub Contractor worker. Retain the work/cost-code description separately.
      date: row.date, description: row.source === 'Timecard' && classification.subcontractor
        ? row.notes?.trim() || row.worker?.trim() || '' : row.description?.trim() || '',
      costCodeDescription: row.source === 'Timecard' ? row.description?.trim() || '' : '',
      logDescription: row.logDescription?.trim() || '',
      notes: row.notes?.trim() || '', worker: row.worker?.trim() || '', costCode: row.costCode?.trim() || '',
      status: row.status?.trim() || 'Not recorded', hours: classification.kind === 'labor' ? quantity : null,
      // Only timecards have a saved source flag. Missing values are not false.
      billable: row.source === 'Timecard' && typeof row.billable === 'boolean' ? row.billable : null,
      quantity, unit: row.uom || '', laborType: classification.subcontractor ? 'Subcontractor' : 'Field labor', note: classification.note,
    };
    report[classification.kind === 'labor' ? 'entries' : 'review'].push(entry);
  }
  const compare = (a: HourEntry, b: HourEntry) => b.date.localeCompare(a.date) || a.projectName.localeCompare(b.projectName)
    || a.source.localeCompare(b.source) || a.key.localeCompare(b.key);
  report.entries.sort(compare); report.review.sort(compare);
  return report;
}

export function hoursFilterError(filters: HoursFilters): string {
  try { usagePeriod(filters.from, filters.through); } catch (error) { return `Work date filter: ${(error as Error).message}`; }
  for (const value of [filters.minHours, filters.maxHours]) {
    if (value.trim() && !Number.isFinite(Number(value))) return 'Enter a valid number for minimum and maximum hours.';
  }
  if (filters.minHours.trim() && filters.maxHours.trim() && Number(filters.minHours) > Number(filters.maxHours)) {
    return 'Minimum hours must be less than or equal to maximum hours.';
  }
  return '';
}

export function filterHourEntries(entries: HourEntry[], filters: HoursFilters): HourEntry[] {
  if (hoursFilterError(filters)) return [];
  const normalize = (value: string) => value.trim().normalize('NFKC').toLowerCase();
  const normalizeDescription = (value: string) => normalize(value).replace(/\bsub[\s_-]*contractors?\b/g, 'subcontractor');
  const matchesText = (values: string[], query: string, mode: HoursTextMatch, normalizer = normalize) => {
    if (!query) return true;
    const found = values.some(value => normalizer(value).includes(query));
    return mode === 'not-contains' ? !found : found;
  };
  const description = normalizeDescription(filters.description);
  const worker = normalize(filters.worker);
  const costCode = normalize(filters.costCode);
  const status = normalize(filters.status);
  const min = filters.minHours.trim() ? Number(filters.minHours) : null;
  const max = filters.maxHours.trim() ? Number(filters.maxHours) : null;
  return entries.filter(row => (!filters.projectId || row.projectId === filters.projectId)
    && (!filters.source || row.source === filters.source)
    && (filters.subcontractor !== 'exclude' || row.laborType !== 'Subcontractor')
    && (filters.subcontractor !== 'only' || row.laborType === 'Subcontractor')
    && (filters.billable !== 'billable' || row.billable === true)
    && (filters.billable !== 'not-billable' || row.billable === false)
    && (filters.billable !== 'not-recorded' || row.billable == null)
    && (!filters.from || row.date >= filters.from) && (!filters.through || row.date <= filters.through)
    && matchesText([row.description || 'No description', row.costCodeDescription || '', row.logDescription, row.notes, row.note,
      row.laborType === 'Subcontractor' ? 'Subcontractor labor' : '',
      row.source === 'Timecard' && row.laborType === 'Subcontractor' ? row.worker : ''], description, filters.descriptionMatch, normalizeDescription)
    && matchesText([row.worker || '—'], worker, filters.workerMatch)
    && matchesText([row.costCode || 'Unassigned'], costCode, filters.costCodeMatch)
    && matchesText([row.status, row.sourceId], status, filters.statusMatch)
    && (min === null || row.hours !== null && row.hours >= min)
    && (max === null || row.hours !== null && row.hours <= max));
}

export function hoursTotals(entries: HourEntry[]) {
  const timecard = round(entries.filter(row => row.source === 'Timecard').reduce((sum, row) => sum + (row.hours || 0), 0));
  const productivity = round(entries.filter(row => row.source === 'Productivity').reduce((sum, row) => sum + (row.hours || 0), 0));
  return { timecard, productivity, combined: round(timecard + productivity), count: entries.length };
}

export function hoursBillableLabel(billable: boolean | null | undefined) {
  return billable === true ? 'Yes' : billable === false ? 'No' : 'Not recorded';
}

/** Export all matching rows, independent of the visible table page. */
export function hoursReportCsv(entries: HourEntry[]) {
  const cell = (value: string | number | null) => {
    const safe = typeof value === 'string' && /^\s*[=+\-@\t\r]/.test(value) ? `'${value}` : value ?? '';
    return `"${String(safe).replaceAll('"', '""')}"`;
  };
  return [['Work date', 'Source', 'Project', 'Project number', 'Project ID', 'Description', 'Daily-log description', 'Notes', 'Worker', 'Cost code', 'Hours', 'Status', 'Labor type', 'Source ID', 'Recorded quantity', 'Recorded unit', 'Review / classification note', 'Cost-code description', 'Billable'],
    ...entries.map(row => [row.date, row.source, row.projectName, row.projectNumber, row.projectId, row.description,
      row.logDescription, row.notes, row.worker, row.costCode, row.hours, row.status, row.laborType, row.sourceId, row.quantity, row.unit, row.note, row.costCodeDescription || '', hoursBillableLabel(row.billable)])]
    .map(row => row.map(cell).join(',')).join('\r\n');
}

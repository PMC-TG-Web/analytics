import { isSubcontractorTimecard } from './qboSubcontractorExclusions.js';

export type BillingHourEntry = {
  id: string; procoreId: string | null; companyId: string; projectId: string | null;
  projectName: string | null; projectNumber: string | null;
  source: 'timesheet' | 'productivity'; date: Date | string; updatedAt: Date | string;
  deletedAt: Date | string | null; hours: number | null; costCode: string | null;
  costCodeName: string | null; description: string | null; partyName: string | null; party?: string | null;
  status: string | null; notes: string | null; uom: string | null;
};

export type BillingHourDetail = {
  id: string; source: BillingHourEntry['source']; date: string; hours: number;
  description: string; status: string; notes: string; uom: string;
};
export type BillingHourRow = {
  key: string; projectId: string; projectName: string; projectNumber: string;
  month: string; costCode: string; costCodeName: string;
  timesheetHours: number; productivityHours: number; totalHours: number;
  entries: BillingHourDetail[];
};

export function isSubcontractorParty(value: string | null): boolean {
  return isSubcontractorTimecard({ partyName: value });
}

export function isSubcontractorHours(value: string | null): boolean {
  // Daily-log display descriptions can include a position and quantity/UOM.
  const label = (value || '').trim().replace(/^#\d+\s*-\s*/, '')
    .replace(/\s*-\s*\d+(?:\.\d+)?\s+[a-z]+\s*$/i, '');
  return /^sub[\s-]*contractors?\s+hours$/i.test(label);
}

export function billingMonthRange(from: string, through: string) {
  if (![from, through].every(value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value))) throw new Error('Select valid start and end months.');
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = through.split('-').map(Number);
  const span = (ty - fy) * 12 + tm - fm;
  if (fy < 2000 || ty > 2100 || span < 0 || span > 23) throw new Error('Select an ordered range of up to 24 months.');
  return { start: new Date(Date.UTC(fy, fm - 1, 1)), end: new Date(Date.UTC(ty, tm, 1)) };
}

const roundHours = (value: number) => Math.round((value + Number.EPSILON) * 10000) / 10000;

export function aggregateBillingHours(entries: BillingHourEntry[], companyId: string) {
  const latest = new Map<string, BillingHourEntry>();
  for (const entry of entries) {
    if (entry.companyId !== companyId) continue;
    const key = JSON.stringify([entry.companyId, entry.projectId, entry.source, entry.procoreId || entry.id]);
    const previous = latest.get(key);
    if (!previous || new Date(entry.updatedAt).getTime() > new Date(previous.updatedAt).getTime()) latest.set(key, entry);
  }
  const rows = new Map<string, BillingHourRow>();
  const warnings = { missingProject: 0, missingCostCode: 0, invalidHours: 0, unapprovedProductivity: 0 };
  for (const entry of latest.values()) {
    if (entry.deletedAt) continue;
    if (entry.source === 'timesheet' ? !isSubcontractorTimecard(entry) : !isSubcontractorHours(entry.description)) continue;
    if (entry.source === 'productivity' && entry.status?.trim().toLowerCase() !== 'approved') {
      warnings.unapprovedProductivity++; continue;
    }
    if (!entry.projectId) { warnings.missingProject++; continue; }
    if (entry.hours === null || !Number.isFinite(entry.hours)) { warnings.invalidHours++; continue; }
    const date = new Date(entry.date).toISOString().slice(0, 10);
    // Procore work dates are date-only values stored at UTC midnight.
    const month = date.slice(0, 7);
    const costCode = (entry.costCode || '').trim().toUpperCase().replace(/\.L$/, '') || '(Unassigned)';
    if (costCode === '(Unassigned)') warnings.missingCostCode++;
    const key = JSON.stringify([companyId, entry.projectId, month, costCode]);
    let row = rows.get(key);
    if (!row) {
      row = { key, projectId: entry.projectId, projectName: entry.projectName || `Project ${entry.projectId}`,
        projectNumber: entry.projectNumber || '', month, costCode, costCodeName: entry.costCodeName || '',
        timesheetHours: 0, productivityHours: 0, totalHours: 0, entries: [] };
      rows.set(key, row);
    }
    if (!row.costCodeName && entry.costCodeName) row.costCodeName = entry.costCodeName;
    if (entry.source === 'timesheet') row.timesheetHours += entry.hours;
    else row.productivityHours += entry.hours;
    row.entries.push({ id: entry.procoreId || entry.id, source: entry.source, date, hours: entry.hours,
      description: entry.description || entry.partyName || '', status: entry.status || 'Not recorded', notes: entry.notes || '', uom: entry.uom || '' });
  }
  const result = [...rows.values()].sort((a, b) => a.projectName.localeCompare(b.projectName) || a.projectId.localeCompare(b.projectId) || a.month.localeCompare(b.month) || a.costCode.localeCompare(b.costCode));
  for (const row of result) {
    row.timesheetHours = roundHours(row.timesheetHours);
    row.productivityHours = roundHours(row.productivityHours);
    row.totalHours = roundHours(row.timesheetHours + row.productivityHours);
    row.entries.sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source) || a.id.localeCompare(b.id));
  }
  return { rows: result, warnings };
}

export function billingHoursCsv(rows: BillingHourRow[]): string {
  const cell = (value: string | number) => `"${String(typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;
  return [['Project ID', 'Project number', 'Project', 'Month', 'Cost code', 'Description', 'Timesheet hours', 'Productivity hours', 'Total hours'],
    ...rows.map(row => [row.projectId, row.projectNumber, row.projectName, row.month, row.costCode, row.costCodeName, row.timesheetHours, row.productivityHours, row.totalHours])]
    .map(row => row.map(cell).join(',')).join('\r\n');
}

import { isSubcontractorProductivity, isSubcontractorTimecard } from './qboSubcontractorExclusions.js';
import { classifyProductivityCompletionLine, normalizeProductivityCompletionUom } from './productivityWeightedCompletion.ts';
import { calculateRebarUsageTons, isRebarUsage } from './rebarUsage.ts';
import { classifyProjectUsageItem } from './projectUsageClassification.ts';

export type UsagePeriod = { from: string; through: string };
export type UsageProject = { procoreProjectId: string; projectName: string; projectNumber: string | null; customer: string | null; status: string | null };
export type UsageRecord = {
  id: string; sourceId: string | null; companyId: string; projectId: string | null;
  source: 'Timecard' | 'Daily log'; date: string; updatedAt: Date | string;
  deletedAt: Date | string | null; status: string | null; quantity: number | null;
  costCode: string | null; description: string | null; worker: string | null;
  holderId: string | null; lineItemId: string | null; costType: string | null;
  uom: string | null; holderTitle: string | null; metadataMatches: number;
  logDescription?: string | null;
};
type ProjectIdentity = { projectId: string; projectName: string; projectNumber: string; customer: string; status: string };
export type UsageLine = ProjectIdentity & {
  source: string; costCode: string; description: string; worker: string;
  holderId: string; lineItemId: string; unit: string; quantity: number; entries: number;
  firstDate: string; lastDate: string; laborType: string; note: string;
  concreteCy: number; rebarTons: number; rebarUnconvertedEntries: number;
};
export type UsageSummary = ProjectIdentity & { timecardHours: number; dailyLogHours: number; subcontractorHours: number; materialLines: number; reviewLines: number;
  concreteCy: number; rebarTons: number; rebarUnconvertedEntries: number };
export type ProjectUsageReport = UsagePeriod & {
  companyId: string; loadedAt: string; latestMirrorUpdate: string | null;
  projects: UsageSummary[]; labor: UsageLine[]; materials: UsageLine[]; other: UsageLine[]; review: UsageLine[];
  excluded: { deleted: number; billingLogs: number };
  projectFilter?: { id: string; name: string };
};

/** Filter every report section by explicit project ID; null means all, including missing-ID review rows. */
export function filterProjectUsageReport(report: ProjectUsageReport, projectId: string | null): ProjectUsageReport {
  if (projectId === null) return report;
  const projects = report.projects.filter(p => p.projectId === projectId);
  return { ...report, projects,
    projectFilter: { id: projectId, name: projects[0]?.projectName || `Project ${projectId}` },
    labor: report.labor.filter(r => r.projectId === projectId),
    materials: report.materials.filter(r => r.projectId === projectId),
    other: report.other.filter(r => r.projectId === projectId),
    review: report.review.filter(r => r.projectId === projectId),
  };
}

export function usagePeriod(from = '', through = ''): UsagePeriod {
  for (const value of [from, through]) {
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)) {
      throw new Error('Enter valid dates in YYYY-MM-DD format.');
    }
  }
  if (from && through && from > through) throw new Error('The start date must be on or before the end date.');
  return { from, through };
}

const clean = (value: string | null | undefined) => value?.trim() || '';
const round = (value: number) => Math.round((value + Number.EPSILON) * 10_000) / 10_000;

/** Source identities, never names, control deduplication and project grouping. */
export function buildProjectUsageReport(companyId: string, period: UsagePeriod, projects: UsageProject[], records: UsageRecord[]): ProjectUsageReport {
  usagePeriod(period.from, period.through);
  const report: ProjectUsageReport = { ...period, companyId, loadedAt: new Date().toISOString(), latestMirrorUpdate: null,
    projects: [], labor: [], materials: [], other: [], review: [], excluded: { deleted: 0, billingLogs: 0 } };
  const summaries = new Map<string, UsageSummary>();
  function project(projectId: string | null) {
    const key = projectId || '';
    if (!summaries.has(key)) summaries.set(key, { projectId: key, projectName: key ? `Project ${key} (not in project directory)` : 'Missing project ID',
      projectNumber: '', customer: '', status: '', timecardHours: 0, dailyLogHours: 0, subcontractorHours: 0, materialLines: 0, reviewLines: 0,
      concreteCy: 0, rebarTons: 0, rebarUnconvertedEntries: 0 });
    return summaries.get(key)!;
  }
  for (const row of projects) Object.assign(project(row.procoreProjectId), {
    projectName: row.projectName, projectNumber: row.projectNumber || '', customer: row.customer || '', status: row.status || '',
  });
  const latest = new Map<string, UsageRecord>();
  for (const row of records) {
    if (row.companyId !== companyId) continue;
    const key = JSON.stringify([row.projectId, row.source, row.sourceId || `local:${row.id}`]);
    const previous = latest.get(key);
    if (!previous || new Date(row.updatedAt).getTime() > new Date(previous.updatedAt).getTime()
      || (String(row.updatedAt) === String(previous.updatedAt) && row.id > previous.id)) latest.set(key, row);
  }
  const groups = { labor: new Map<string, UsageLine>(), materials: new Map<string, UsageLine>(), other: new Map<string, UsageLine>(), review: new Map<string, UsageLine>() };
  for (const row of latest.values()) {
    if ((period.from && row.date < period.from) || (period.through && row.date > period.through)) continue;
    if (row.deletedAt || /^(deleted|void|voided)$/i.test(clean(row.status))) { report.excluded.deleted++; continue; }
    if (row.source === 'Daily log' && /billing file/i.test(row.holderTitle || '')) { report.excluded.billingLogs++; continue; }
    const summary = project(row.projectId);
    const update = new Date(row.updatedAt).toISOString();
    if (!report.latestMirrorUpdate || update > report.latestMirrorUpdate) report.latestMirrorUpdate = update;
    let kind: keyof typeof groups = 'review';
    let note = '';
    let unit = clean(row.uom).toUpperCase();
    let laborType = '';
    const subcontractor = row.source === 'Timecard' ? isSubcontractorTimecard({ partyName: row.worker }) : isSubcontractorProductivity(row.description);
    const labor = /^(l|labor|labour)$/i.test(clean(row.costType));
    const itemClassification = row.source === 'Daily log' && row.metadataMatches === 1 ? classifyProjectUsageItem(row) : null;
    if (!row.projectId) note = 'Missing Procore project ID.';
    else if (row.quantity == null || !Number.isFinite(row.quantity)) note = 'Missing or invalid quantity.';
    else if (row.source === 'Timecard') { kind = 'labor'; unit = 'HR'; }
    else if (row.metadataMatches !== 1) note = 'Purchase-order line not found or has conflicting coding.';
    else if (itemClassification) {
      kind = itemClassification.kind; unit = itemClassification.unit; note = itemClassification.note;
    }
    else if ((labor || subcontractor) && (/^(h|hr|hrs|hour|hours)$/i.test(unit) || /^ls$/i.test(unit))) {
      kind = 'labor';
      if (unit === 'LS') note = 'Legacy labor LS quantities are recorded as hours, consistent with field analytics.';
      unit = 'HR';
    } else if (labor || subcontractor) note = `Labor quantity is recorded in ${unit || 'an unknown unit'}; excluded from hours.`;
    else if (/^(m|material|materials)$/i.test(clean(row.costType))) {
      unit = (normalizeProductivityCompletionUom(row) || '').toUpperCase();
      if (!unit) note = 'Material unit is missing.';
      else kind = 'materials';
    } else if (!clean(row.costType)) note = 'Cost type is missing; cannot identify labor or material.';
    else { kind = 'other'; note = `Cost type ${row.costType}; excluded from labor and material totals.`; }
    if (kind === 'labor') {
      laborType = subcontractor ? 'Subcontractor' : 'Field labor';
      if (row.source === 'Timecard') summary.timecardHours += row.quantity!;
      else summary.dailyLogHours += row.quantity!;
      if (subcontractor) summary.subcontractorHours += row.quantity!;
    }
    const identity = { projectId: summary.projectId, projectName: summary.projectName, projectNumber: summary.projectNumber, customer: summary.customer, status: summary.status };
    const values = { ...identity, source: row.source, costCode: clean(row.costCode), description: clean(row.description), worker: clean(row.worker),
      holderId: clean(row.holderId), lineItemId: clean(row.lineItemId), unit, laborType, note };
    // Keep different PO lines, workers, descriptions, cost codes and units separate.
    const key = JSON.stringify(values);
    let group = groups[kind].get(key);
    if (!group) {
      group = { ...values, quantity: 0, entries: 0, firstDate: row.date, lastDate: row.date, concreteCy: 0, rebarTons: 0, rebarUnconvertedEntries: 0 };
      groups[kind].set(key, group);
    }
    group.quantity += Number.isFinite(row.quantity) ? row.quantity! : 0;
    group.entries++;
    if (kind === 'materials') {
      // Some pump services share concrete coding/units; they are not placed concrete.
      const pump = /\b(?:pumps?|pumping)\b/i.test([row.description, row.logDescription].filter(Boolean).join(' / '));
      if (unit === 'CY' && classifyProductivityCompletionLine({ ...row, uom: unit }) === 'concrete' && !pump) {
        summary.concreteCy += row.quantity!;
        group.concreteCy += row.quantity!;
      }
      if (isRebarUsage([row.description, row.logDescription].filter(Boolean).join(' / '))) {
        const tons = calculateRebarUsageTons(row.quantity!, row.uom || '', [row.description, row.logDescription]);
        if (tons === null) { summary.rebarUnconvertedEntries++; group.rebarUnconvertedEntries++; }
        else { summary.rebarTons += tons; group.rebarTons += tons; }
      }
    }
    if (row.date < group.firstDate) group.firstDate = row.date;
    if (row.date > group.lastDate) group.lastDate = row.date;
  }
  const compare = (a: ProjectIdentity, b: ProjectIdentity) => a.projectName.localeCompare(b.projectName) || a.projectId.localeCompare(b.projectId);
  for (const kind of Object.keys(groups) as (keyof typeof groups)[]) {
    report[kind] = [...groups[kind].values()].sort((a, b) => compare(a, b) || a.costCode.localeCompare(b.costCode) || a.description.localeCompare(b.description));
    for (const line of report[kind]) {
      line.quantity = round(line.quantity);
      line.concreteCy = round(line.concreteCy);
      line.rebarTons = round(line.rebarTons);
      if (kind === 'materials') project(line.projectId).materialLines++;
      if (kind === 'review') project(line.projectId).reviewLines++;
    }
  }
  report.projects = [...summaries.values()].sort(compare).map(row => ({ ...row,
    timecardHours: round(row.timecardHours), dailyLogHours: round(row.dailyLogHours), subcontractorHours: round(row.subcontractorHours),
    concreteCy: round(row.concreteCy), rebarTons: round(row.rebarTons) }));
  return report;
}

import { sameWipSource, type WipProject } from './wipPlanning.ts';

export type SteelKind = 'Rebar' | 'Wire';
export type SteelEstimateLine = {
  companyId: string; bidBoardProjectId: string; proposalId: string; lineItemId: string;
  name: string | null; uom: string | null; quantity: unknown; payload?: unknown; syncedAt: string;
};
export type SteelActivity = { projectId: string; dailyLogs: number; timesheets: number; firstActivity: string | null };
export type SteelOrder = { revision: number; orderedAt: string | null; quantity: number | null };
export type SteelItem = { key: string; description: string; kind: SteelKind; unit: string; quantity: number; lineCount: number; order: SteelOrder | null };
export type SteelProject = {
  key: string; projectId: string | null; projectName: string; projectNumber: string; customer: string;
  bidBoardId: string; proposalId: string; started: boolean | null; dailyLogs: number; timesheets: number;
  firstActivity: string | null; plannedStart: string | null; planChanged: boolean; items: SteelItem[];
  issues: string[]; estimateSyncedAt: string | null;
};
export type SteelReport = { projects: SteelProject[]; loadedAt: string; localOnly: boolean };
export type SteelTotal = SteelItem & { startedQuantity: number; notStartedQuantity: number; projects: (SteelItem & { project: SteelProject })[] };
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const clean = (value: unknown) => String(value ?? '').trim().replace(/\s+/g, ' ');

/** Unit aliases do not convert quantities between pieces, length or weight. */
export function steelUnit(value: unknown): string {
  const unit = clean(value).toLowerCase();
  if (['ea', 'each', 'pc', 'pcs', 'piece', 'pieces'].includes(unit)) return 'EA';
  if (['lf', 'lin ft', 'linear feet', 'linear foot'].includes(unit)) return 'LF';
  if (['sf', 'sq ft', 'square feet', 'square foot'].includes(unit)) return 'SF';
  if (['lb', 'lbs', 'pound', 'pounds'].includes(unit)) return 'LB';
  return unit.toUpperCase();
}

export function steelKind(description: string, costType = '', unit = ''): SteelKind | null {
  if (/^(labor|equipment|subcontractor|l|e|s)$/i.test(costType.trim())
    || /^(h|hr|hrs|hour|hours)$/i.test(unit.trim())
    || /\b(labor|installation|install|fabrication|rental|fiber|fiberglass|chairs?|supports?|spacers?|tubes?|sleeves?)\b/i.test(description)) return null;
  if (/\b(wire|wwf|wwr|welded wire|reinforcing mesh)\b/i.test(description)) return 'Wire';
  return /\b(rebar|reinforcing bars?|reinforcement bars?)\b/i.test(description) ? 'Rebar' : null;
}

const isWireMesh = (description: string) => /\b(wire\s+mesh|welded\s+wire|wwf|wwr|reinforcing\s+mesh)\b/i.test(description);

/** Explicit feet distinguish sheet dimensions from mesh spacing such as 6x6. */
export function wireMeshDescription(description: string): string | null {
  if (!isWireMesh(description)) return null;
  const gauges = new Set([...description.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:ga|gauge)\b/gi)].map(match => Number(match[1])));
  // Owner-confirmed catalog convention; do not infer other gauges from W designations.
  const wireAreas = [...description.matchAll(/\bW\s*(\d+(?:\.\d+)?)\b/gi)].map(match => Number(match[1]));
  if (wireAreas.length === 2 && wireAreas.every(value => value === 4)) gauges.add(4);
  const sheets = new Set([...description.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:['’′]|ft\.?|feet|foot)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:['’′]|ft\b\.?|feet\b|foot\b)/gi)]
    .filter(match => Number(match[1]) > 0 && Number(match[2]) > 0)
    .map(match => [Number(match[1]), Number(match[2])].sort((a, b) => a - b).map(value => `${value}'`).join('x')));
  // Only absent dimensions get the 6-ga default. Preserve unsupported or conflicting sizes for review.
  const hasDimensionText = /\d\s*(?:['’′"”″]|ft\b|feet\b|foot\b|in\b|inch(?:es)?\b)/i.test(description)
    || /\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?/i.test(description.replace(/\([^)]*\)/g, '').replace(/\b6\s*[x×]\s*6\b/g, ''));
  if (gauges.size === 1 && gauges.has(6) && sheets.size === 0 && !hasDimensionText) sheets.add("5'x10'");
  if (gauges.size !== 1 || [...gauges][0] <= 0 || sheets.size !== 1) return null;
  return `Wire Mesh ${[...gauges][0]} ga ${[...sheets][0]}`;
}

/** Ordering groups use rebar size or wire mesh gauge + sheet dimensions. */
export function steelDescription(description: string, kind: SteelKind): string {
  if (kind === 'Wire') return wireMeshDescription(description) || description;
  const sizes = new Set([...description.matchAll(/#\s*(\d+)\b/g)].map(match => Number(match[1])));
  // Never invent a bar size for missing or conflicting specifications.
  if (sizes.size !== 1 || [...sizes][0] <= 0) return description;
  return `#${[...sizes][0]} Rebar - 20' Pc`;
}

export function buildSteelNeeds(companyId: string, projects: WipProject[], lines: SteelEstimateLine[], activity: SteelActivity[]): SteelProject[] {
  const byProposal = new Map<string, SteelEstimateLine[]>();
  const seen = new Set<string>();
  for (const line of lines) {
    if (line.companyId !== companyId) continue;
    const key = JSON.stringify([line.bidBoardProjectId, line.proposalId]);
    const identity = JSON.stringify([key, line.lineItemId]);
    if (seen.has(identity)) throw new Error('Repeated estimate line identity.');
    seen.add(identity);
    byProposal.set(key, [...(byProposal.get(key) || []), line]);
  }
  const byProject = new Map(activity.map(row => [row.projectId, row]));
  return projects.map(project => {
    const entries = project.projectId ? byProject.get(project.projectId) : undefined;
    const sourceLines = byProposal.get(JSON.stringify([project.source.bidBoardId, project.source.proposalId])) || [];
    const issues: string[] = [];
    const items = new Map<string, SteelItem>();
    // WIP's labor-hour validation is independent of steel quantities. Only identity ambiguity blocks this source.
    const blocked = !project.projectId || !!project.issue?.startsWith('Multiple estimates');
    if (blocked) issues.push(project.issue || 'Waiting for the linked Procore project to synchronize.');
    if (!project.source.proposalId || !sourceLines.length) issues.push('Estimate line items are not available; steel requirements are unknown.');
    for (const line of blocked ? [] : sourceLines) {
      const payload = record(line.payload), costItem = record(payload.cost_item);
      // Classify the original name before trimming so accessories/services remain excluded.
      const sourceDescription = clean(line.name || costItem.name || costItem.description);
      const unit = steelUnit(line.uom || costItem.unit);
      const kind = steelKind(sourceDescription, clean(costItem.cost_type_code || costItem.type), unit);
      if (!kind) continue;
      const description = steelDescription(sourceDescription, kind);
      if (kind === 'Wire' && isWireMesh(sourceDescription) && !wireMeshDescription(sourceDescription)) {
        issues.push(`${sourceDescription}: wire mesh gauge or sheet size is missing or ambiguous; kept separate for review.`);
      }
      const quantity = line.quantity === null || line.quantity === undefined || clean(line.quantity) === '' ? NaN : Number(line.quantity);
      if (!unit || !Number.isFinite(quantity) || quantity < 0) {
        issues.push(`${description}: missing unit or invalid quantity; excluded from totals.`); continue;
      }
      if (!quantity) continue;
      const key = JSON.stringify([description.toLowerCase(), unit]);
      const item = items.get(key) || { key, description, kind, unit, quantity: 0, lineCount: 0, order: null };
      item.quantity = Math.round((item.quantity + quantity) * 10000) / 10000;
      item.lineCount++;
      items.set(key, item);
    }
    const months = (project.plan?.allocations || []).filter(row => row.percent > 0 && /^20\d{2}-(0[1-9]|1[0-2])$/.test(row.month)).map(row => row.month).sort();
    const plannedStart = months[0] || null;
    if (!plannedStart) issues.push('No saved WIP start month.');
    const planChanged = !!project.plan && !sameWipSource(project.source, project.plan.source);
    if (planChanged) issues.push('WIP estimate basis changed; review its saved start month.');
    return {
      key: project.key, projectId: project.projectId, projectName: project.projectName, projectNumber: project.projectNumber,
      customer: project.customer, bidBoardId: project.source.bidBoardId, proposalId: project.source.proposalId,
      started: project.projectId ? !!(entries && (entries.dailyLogs || entries.timesheets)) : null,
      dailyLogs: entries?.dailyLogs || 0, timesheets: entries?.timesheets || 0, firstActivity: entries?.firstActivity || null,
      plannedStart, planChanged, items: [...items.values()].sort((a, b) => a.description.localeCompare(b.description) || a.unit.localeCompare(b.unit)),
      issues, estimateSyncedAt: sourceLines.map(line => line.syncedAt).sort()[0] || null,
    };
  }).sort((a, b) => (a.plannedStart || '9999').localeCompare(b.plannedStart || '9999') || a.projectName.localeCompare(b.projectName));
}

export type SteelFilters = { status: string; kind: string; query: string; projectId: string; through: string; timing: string };
export function filterSteelProjects(projects: SteelProject[], filters: SteelFilters): SteelProject[] {
  const query = filters.query.trim().toLowerCase();
  return projects.filter(project => {
    if (filters.status === 'started' && project.started !== true || filters.status === 'not-started' && project.started !== false) return false;
    if (filters.projectId && project.key !== filters.projectId) return false;
    if (filters.timing === 'unscheduled' && project.plannedStart) return false;
    if (filters.through && (!project.plannedStart || project.plannedStart > filters.through)) return false;
    return true;
  }).map(project => {
    const projectMatches = `${project.projectName} ${project.projectNumber} ${project.customer}`.toLowerCase().includes(query);
    return { ...project, items: project.items.filter(item => (!filters.kind || item.kind === filters.kind) && (!query || projectMatches || item.description.toLowerCase().includes(query))) };
  }).filter(project => project.items.length || (!filters.kind && (!query || `${project.projectName} ${project.projectNumber} ${project.customer}`.toLowerCase().includes(query))));
}

export function aggregateSteelNeeds(projects: SteelProject[]): SteelTotal[] {
  const totals = new Map<string, SteelTotal>();
  for (const project of projects) for (const item of project.items) {
    const total = totals.get(item.key) || { ...item, quantity: 0, lineCount: 0, startedQuantity: 0, notStartedQuantity: 0, projects: [] };
    total.quantity += item.quantity; total.lineCount += item.lineCount;
    if (project.started) total.startedQuantity += item.quantity;
    else total.notStartedQuantity += item.quantity;
    total.projects.push({ ...item, project }); totals.set(item.key, total);
  }
  return [...totals.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.description.localeCompare(b.description) || a.unit.localeCompare(b.unit));
}

export function steelNeedsCsv(projects: SteelProject[]): string {
  const quote = (value: unknown) => {
    const text = String(value ?? '');
    return `"${(/^[=+\-@\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
  };
  const rows: unknown[][] = [['Description', 'Material', 'Unit', 'Full estimated quantity', 'Project', 'Project number', 'Status', 'WIP planned start month', 'First field entry', 'Procore project ID', 'Bid Board ID', 'Estimate ID', 'Review notes', 'Marked ordered', 'Ordered date (Eastern)', 'Estimate when marked']];
  for (const project of projects) for (const item of project.items) rows.push([item.description, item.kind, item.unit, item.quantity, project.projectName, project.projectNumber, project.started ? 'Started' : 'Not started', project.plannedStart, project.firstActivity, project.projectId, project.bidBoardId, project.proposalId, project.issues.join(' '), item.order?.orderedAt ? 'Yes' : 'No', item.order?.orderedAt ? steelOrderedDate(item.order.orderedAt) : '', item.order?.quantity ?? '' ]);
  return '\uFEFF' + rows.map(row => row.map(quote).join(',')).join('\r\n');
}

export function steelOrderedDate(timestamp: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: 'numeric' }).format(new Date(timestamp));
}

export function attachSteelOrderMarks(projects: SteelProject[], marks: (SteelOrder & { projectId: string; itemKey: string })[]): SteelProject[] {
  const byItem = new Map(marks.map(mark => [JSON.stringify([mark.projectId, mark.itemKey]), mark]));
  return projects.map(project => ({ ...project, items: project.items.map(item => {
    const mark = byItem.get(JSON.stringify([project.projectId, item.key]));
    return { ...item, order: mark ? { revision: mark.revision, orderedAt: mark.orderedAt, quantity: mark.quantity } : null };
  }) }));
}

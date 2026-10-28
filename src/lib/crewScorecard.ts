import { classifyConcreteGroup, classifyLaborGroup, type ConcreteGroup } from './estimatingDashboardLogic.ts';
import { classifyProductivityCompletionLine, normalizeProductivityCompletionUom } from './productivityWeightedCompletion.ts';
import { isSubcontractorProductivity, isSubcontractorTimecard } from './qboSubcontractorExclusions.js';
import { rebarWeightPerFoot } from './rebarSpecifications.ts';

type SourceRecord = {
  id: string;
  procoreId: string | null;
  companyId: string;
  projectId: string | null;
  date: string;
  creatorId: string | null;
  creatorName: string | null;
  creatorLogin: string | null;
  syncedAt: Date | string;
  sourceUpdatedAt?: Date | string | null;
  deletedAt?: Date | string | null;
  status?: string | null;
};

export type CrewTimecard = SourceRecord & {
  hours: number | null;
  workerId: string | null;
  workerName: string | null;
  party: string | null;
  costCode: string | null;
  costCodeName: string | null;
};

export type CrewProductionLog = SourceRecord & {
  quantity: number | null;
  lineItemId: string | null;
  holderTitle: string | null;
  description: string | null;
  logDescription?: string | null;
  costCode: string | null;
  costType: string | null;
  uom: string | null;
  metadataMatches: number;
};

export type CrewEmployee = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  jobTitle: string | null;
  isActive: boolean;
};

export type CrewProject = {
  procoreProjectId: string;
  bidBoardId: string | null;
  projectName: string | null;
  projectNumber: string | null;
};

export type CrewEstimate = {
  procoreProjectId?: string | null;
  bidBoardId: string;
  selectedProposalId?: string | null;
  proposalName?: string | null;
  pmcGroup: Record<string, number>;
  concreteGroup: Record<string, number>;
};

export type CrewReviewItem = {
  kind: 'quantity-log' | 'timecards' | 'hours-overlap' | 'source';
  date: string;
  projectId: string | null;
  projectName: string;
  message: string;
};

export type CrewDay = {
  date: string;
  projectId: string | null;
  projectName: string;
  hours: number;
  timecardHours: number;
  logHours: number;
  timecardCount: number;
  logCount: number;
};

export type CrewQuantity = {
  projectName: string;
  projectId: string | null;
  lineItemId: string | null;
  description: string;
  costCode: string | null;
  unit: string;
  quantity: number;
  logCount: number;
  logDescription: string | null;
  rebarTons: number | null;
  rebarUncalculatedCount: number;
};

export type CrewRate = {
  projectId: string | null;
  projectName: string;
  workType: ConcreteGroup;
  hours: number;
  concrete: number;
  actualRate: number | null;
  estimatedRate: number | null;
  percentOfEstimate: number | null;
  estimateName: string | null;
  reason: string | null;
};

export type CrewScore = {
  id: string;
  name: string;
  isForeman: boolean;
  hours: number;
  timecardHours: number;
  logHours: number;
  travelHours: number;
  otherHours: number;
  concrete: number;
  rebarTons: number;
  rebarCalculatedEntries: number;
  rebarUncalculatedEntries: number;
  workers: number;
  timecardCount: number;
  logCount: number;
  days: CrewDay[];
  quantities: CrewQuantity[];
  rates: CrewRate[];
  review: CrewReviewItem[];
};

export type CrewScorecard = {
  companyId: string;
  week: string;
  through: string;
  today: string;
  loadedAt: string;
  newestTimecardDate: string | null;
  newestLogDate: string | null;
  foremanCount: number;
  excluded: { subcontractorTimecards: number; billingLogs: number; subcontractorLogs: number; deleted: number };
  crews: CrewScore[];
};

const laborGroups: Record<ConcreteGroup, string> = {
  'Slab On Grade': 'Slab On Grade Labor',
  Foundation: 'Foundation Labor',
  Wall: 'Wall Labor',
  Site: 'Site Concrete Labor',
};
const concreteCodes: Record<string, ConcreteGroup> = {
  '03-300-20-20': 'Slab On Grade',
  '03-300-00-20': 'Foundation',
  '03-300-10-20': 'Wall',
  '03-300-30-20': 'Site',
  '05-100-10-20': 'Site',
};
const clean = (value: string | null | undefined) => (value || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
const dateValue = (value: Date | string | null | undefined) => value ? new Date(value).getTime() : 0;
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const hourUnit = (unit: string | null) => /^(h|hr|hrs|hour|hours)$/i.test(unit?.trim() || '');
const eachUnit = (unit: string | null) => /^(ea|each|pc|pcs|piece|pieces)$/i.test(unit?.trim() || '');

function rebarDescription(row: Pick<CrewProductionLog, 'description' | 'logDescription'>) {
  return [row.description, row.logDescription].filter(Boolean).join(' / ');
}

function isRebarBarDescription(description: string) {
  return /\b(?:rebar|reinforcing bars?|reinforcement bars?)\b/i.test(description)
    && !/\b(?:chairs?|dowels?|wire|meshes?|wwf|spacers?|sleeves?|fabrication)\b/i.test(description);
}

export function calculateInstalledRebarTons(quantity: number, unit: string | null, description: string) {
  if (!finite(quantity) || !eachUnit(unit) || !isRebarBarDescription(description)) return null;
  const barSize = description.match(/#\s*(3|4|5|6|7|8)\s*(?:[-–]\s*)?(?:rebar|bar)\b/i)
    || description.match(/\b(?:rebar|bar)\s*#\s*(3|4|5|6|7|8)\b/i);
  const length = description.match(/\b(\d+(?:\.\d+)?)\s*(?:'|′|ft\.?\b|feet\b|foot\b)/i);
  if (!barSize || !length) return null;
  const weightPerFoot = rebarWeightPerFoot[`#${barSize[1]}`];
  const lengthFeet = Number(length[1]);
  if (!finite(weightPerFoot) || !Number.isFinite(lengthFeet) || lengthFeet <= 0) return null;
  return quantity * lengthFeet * weightPerFoot / 2000;
}

export function crewToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function crewWeekStart(date: string): string {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose a valid work date (YYYY-MM-DD).');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('Choose a valid work date (YYYY-MM-DD).');
  parsed.setUTCDate(parsed.getUTCDate() - (parsed.getUTCDay() + 6) % 7);
  return parsed.toISOString().slice(0, 10);
}

export function crewWeekRange(week: string) {
  if (crewWeekStart(week) !== week) throw new Error('The reporting week must start on Monday.');
  const start = new Date(`${week}T00:00:00Z`);
  const end = new Date(start.getTime() + 7 * 86_400_000);
  return { start, end, through: new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10) };
}

function latestRecords<T extends SourceRecord>(rows: T[], companyId: string): T[] {
  const latest = new Map<string, T>();
  for (const row of rows) {
    if (row.companyId !== companyId) continue;
    const key = JSON.stringify([row.projectId, row.procoreId || `local:${row.id}`]);
    const previous = latest.get(key);
    const recency = (item: T) => dateValue(item.sourceUpdatedAt) || dateValue(item.syncedAt);
    if (!previous || recency(row) > recency(previous)
      || (recency(row) === recency(previous) && dateValue(row.syncedAt) > dateValue(previous.syncedAt))
      || (recency(row) === recency(previous) && dateValue(row.syncedAt) === dateValue(previous.syncedAt) && row.id > previous.id)) latest.set(key, row);
  }
  return [...latest.values()];
}

function unique<T>(values: T[]): T | null {
  return values.length === 1 ? values[0] : null;
}

export function selectCrewEstimate(project: CrewProject | undefined, estimates: CrewEstimate[]): CrewEstimate | null {
  if (!project) return null;
  const candidates = estimates.filter(estimate => estimate.procoreProjectId === project.procoreProjectId && estimate.selectedProposalId);
  if (project.bidBoardId) return unique(candidates.filter(estimate => estimate.bidBoardId === project.bidBoardId));
  return unique(candidates);
}

function identityResolver(records: SourceRecord[], employees: CrewEmployee[]) {
  const known = employees.filter(employee => employee.isActive && /^(foreman|forman|lead foreman|lead foreman \/ project manager)$/i.test(employee.jobTitle?.trim() || ''));
  const aliases = new Map<string, Set<string>>();
  const primaryKey = (row: SourceRecord) => row.creatorId ? `id:${row.creatorId}` : clean(row.creatorLogin) ? `email:${clean(row.creatorLogin)}` : null;
  for (const row of records) {
    if (!row.creatorId) continue;
    const key = `id:${row.creatorId}`;
    for (const alias of [clean(row.creatorLogin), clean(row.creatorName)].filter(Boolean)) {
      const keys = aliases.get(alias) || new Set<string>();
      keys.add(key);
      aliases.set(alias, keys);
    }
  }
  for (const row of records) {
    if (row.creatorId || !clean(row.creatorLogin)) continue;
    const login = clean(row.creatorLogin);
    const keys = aliases.get(login) || new Set([`email:${login}`]);
    aliases.set(login, keys);
    const name = clean(row.creatorName);
    if (name) aliases.set(name, new Set([...(aliases.get(name) || []), ...keys]));
  }
  function actorKey(row: SourceRecord) {
    const aliasKeys = aliases.get(clean(row.creatorLogin)) || aliases.get(clean(row.creatorName));
    return row.creatorId ? `id:${row.creatorId}`
      : aliasKeys?.size === 1 ? [...aliasKeys][0]
      : primaryKey(row) || (clean(row.creatorName) ? `name:${clean(row.creatorName)}` : 'unattributed');
  }
  const employeesByActor = new Map<string, Map<string, CrewEmployee>>();
  for (const row of records) {
    const login = clean(row.creatorLogin);
    const name = clean(row.creatorName);
    const matches = login ? known.filter(employee => clean(employee.email) === login) : [];
    const employee = unique(matches) || (name && (aliases.get(name)?.size || 0) <= 1
      ? unique(known.filter(person => clean(`${person.firstName} ${person.lastName}`) === name)) : null);
    if (!employee || (login && (aliases.get(login)?.size || 0) > 1)) continue;
    const candidates = employeesByActor.get(actorKey(row)) || new Map<string, CrewEmployee>();
    candidates.set(employee.id, employee);
    employeesByActor.set(actorKey(row), candidates);
  }
  return {
    known,
    resolve(row: SourceRecord) {
      const key = actorKey(row);
      const employee = unique([...(employeesByActor.get(key)?.values() || [])]);
      if (employee) return { id: `foreman:${employee.id}`, name: `${employee.firstName} ${employee.lastName}`, isForeman: true };
      return { id: key, name: row.creatorName?.trim() || (key === 'unattributed' ? 'Unattributed records' : 'Unnamed submitter'), isForeman: false };
    },
  };
}

type WorkingCrew = CrewScore & {
  workerIds: Set<string>;
  dayMap: Map<string, CrewDay>;
  quantityMap: Map<string, CrewQuantity>;
  rateMap: Map<string, CrewRate>;
};

export function buildCrewScorecard(input: {
  companyId: string;
  week: string;
  now?: Date;
  employees: CrewEmployee[];
  projects: CrewProject[];
  estimates: CrewEstimate[];
  timecards: CrewTimecard[];
  logs: CrewProductionLog[];
}): CrewScorecard {
  const now = input.now || new Date();
  const today = crewToday(now);
  const { through } = crewWeekRange(input.week);
  const inWeek = (row: SourceRecord) => row.date >= input.week && row.date <= through;
  const timecards = latestRecords(input.timecards, input.companyId).filter(inWeek);
  const logs = latestRecords(input.logs, input.companyId).filter(inWeek);
  const identities = identityResolver([...timecards, ...logs], input.employees);
  const projects = new Map(input.projects.map(project => [project.procoreProjectId, project]));
  const crews = new Map<string, WorkingCrew>();
  const excluded = { subcontractorTimecards: 0, billingLogs: 0, subcontractorLogs: 0, deleted: 0 };
  let newestTimecardDate: string | null = null;
  let newestLogDate: string | null = null;

  function getCrew(identity: { id: string; name: string; isForeman: boolean }) {
    let crew = crews.get(identity.id);
    if (!crew) {
      crew = { ...identity, hours: 0, timecardHours: 0, logHours: 0, travelHours: 0, otherHours: 0, concrete: 0,
        rebarTons: 0, rebarCalculatedEntries: 0, rebarUncalculatedEntries: 0, workers: 0,
        timecardCount: 0, logCount: 0, days: [], quantities: [], rates: [], review: [],
        workerIds: new Set(), dayMap: new Map(), quantityMap: new Map(), rateMap: new Map() };
      crews.set(identity.id, crew);
    }
    return crew;
  }
  for (const person of identities.known) getCrew({ id: `foreman:${person.id}`, name: `${person.firstName} ${person.lastName}`, isForeman: true });

  function context(row: SourceRecord) {
    const crew = getCrew(identities.resolve(row));
    const project = row.projectId ? projects.get(row.projectId) : undefined;
    const projectName = project?.projectName || (row.projectId ? `Project ${row.projectId}` : 'Unlinked project');
    // Unlinked records cannot establish that two entries belong to the same job.
    const projectKey = row.projectId || `unlinked:${row.id}`;
    const dayKey = JSON.stringify([row.date, projectKey]);
    let day = crew.dayMap.get(dayKey);
    if (!day) {
      day = { date: row.date, projectId: row.projectId, projectName, hours: 0, timecardHours: 0, logHours: 0, timecardCount: 0, logCount: 0 };
      crew.dayMap.set(dayKey, day);
    }
    const warn = (message: string) => crew.review.push({ kind: 'source', date: row.date, projectId: row.projectId, projectName, message });
    if (!project) warn('Canonical project link is missing; no estimate comparison is available.');
    if (crew.id === 'unattributed') warn('The submitter is missing. These records cannot establish crew productivity or reporting coverage.');
    return { crew, project, projectName, projectKey, day, warn };
  }
  function getRate(crew: WorkingCrew, projectKey: string, projectId: string | null, projectName: string, workType: ConcreteGroup) {
    const key = JSON.stringify([projectKey, workType]);
    let rate = crew.rateMap.get(key);
    if (!rate) {
      rate = { projectId, projectName, workType, hours: 0, concrete: 0, actualRate: null,
        estimatedRate: null, percentOfEstimate: null, estimateName: null, reason: null };
      crew.rateMap.set(key, rate);
    }
    return rate;
  }
  function addLaborHours(crew: WorkingCrew, projectKey: string, projectId: string | null, projectName: string,
    hours: number, costCode: string | null, name: string | null) {
    const group = classifyLaborGroup({ costCode, name });
    const workType = (Object.keys(laborGroups) as ConcreteGroup[]).find(type => laborGroups[type] === group);
    if (workType) getRate(crew, projectKey, projectId, projectName, workType).hours += hours;
    else if (group === 'Travel Labor') crew.travelHours += hours;
    else crew.otherHours += hours;
  }
  function deleted(row: SourceRecord) {
    if (row.deletedAt || /^(deleted|void|voided)$/i.test(row.status?.trim() || '')) {
      excluded.deleted += 1;
      return true;
    }
    return false;
  }
  for (const row of timecards) {
    if (deleted(row)) continue;
    if (isSubcontractorTimecard({ partyName: row.workerName, party: row.party })) { excluded.subcontractorTimecards += 1; continue; }
    const { crew, day, projectKey, projectName, warn } = context(row);
    if (!finite(row.hours)) { warn('A timecard has missing or invalid hours and is excluded from totals.'); continue; }
    crew.hours += row.hours;
    crew.timecardHours += row.hours;
    crew.timecardCount += 1;
    day.hours += row.hours;
    day.timecardHours += row.hours;
    day.timecardCount += 1;
    const worker = row.workerId || clean(row.workerName);
    if (worker && row.hours > 0) crew.workerIds.add(worker);
    if (!worker) warn('A timecard has no worker identity; the worker count is incomplete.');
    if (!row.costCode?.trim()) warn('A timecard has no cost code; its hours cannot be compared with an estimate.');
    addLaborHours(crew, projectKey, row.projectId, projectName, row.hours, row.costCode, row.costCodeName);
    if (!newestTimecardDate || row.date > newestTimecardDate) newestTimecardDate = row.date;
  }
  for (const row of logs) {
    if (deleted(row)) continue;
    if (/billing file/i.test(row.holderTitle || '')) { excluded.billingLogs += 1; continue; }
    if (isSubcontractorProductivity(row.description)) { excluded.subcontractorLogs += 1; continue; }
    const { crew, day, projectKey, projectName, warn } = context(row);
    if (!finite(row.quantity)) { warn('A field log has missing or invalid quantity and is excluded from quantities.'); continue; }
    crew.logCount += 1;
    day.logCount += 1;
    if (!newestLogDate || row.date > newestLogDate) newestLogDate = row.date;
    if (row.metadataMatches !== 1) warn('A field log has missing or ambiguous PO metadata; its unit and production rate are unavailable.');
    // Some confirmed labor PO lines use LS as their quantity unit even though entries are hours.
    const laborType = /^(l|labor)$/i.test(row.costType?.trim() || '');
    const laborHours = row.metadataMatches === 1 && (hourUnit(row.uom) || (laborType && /^ls$/i.test(row.uom?.trim() || '')));
    if (laborHours) {
      crew.hours += row.quantity;
      crew.logHours += row.quantity;
      day.hours += row.quantity;
      day.logHours += row.quantity;
      if (!row.costCode?.trim()) warn('A daily-log labor-hour entry has no cost code; its hours cannot be compared with an estimate.');
      addLaborHours(crew, projectKey, row.projectId, projectName, row.quantity, row.costCode, row.description);
      continue;
    }
    if (row.metadataMatches === 1 && laborType) {
      warn(`Labor item "${row.description || row.costCode || 'Unnamed'}" is recorded in ${row.uom?.trim() || 'no unit'}, not hours; it is not counted as field hours.`);
    }
    const unit = row.metadataMatches === 1 && row.uom?.trim() ? normalizeProductivityCompletionUom(row) : null;
    const normalizedUnit = unit?.trim().toUpperCase() || 'Unknown unit';
    if (!unit && row.metadataMatches === 1) warn('A field log has no unit; it cannot contribute to a production rate.');
    const key = JSON.stringify([projectKey, row.lineItemId || row.id, normalizedUnit]);
    let quantity = crew.quantityMap.get(key);
    if (!quantity) {
      quantity = { projectName, projectId: row.projectId, lineItemId: row.lineItemId, description: row.description || 'Unresolved field item',
        costCode: row.costCode, unit: normalizedUnit, quantity: 0, logCount: 0, logDescription: row.logDescription || null,
        rebarTons: null, rebarUncalculatedCount: 0 };
      crew.quantityMap.set(key, quantity);
    }
    quantity.quantity += row.quantity;
    quantity.logCount += 1;
    if (!quantity.logDescription && row.logDescription) quantity.logDescription = row.logDescription;
    const lineDescription = rebarDescription(row);
    if (isRebarBarDescription(lineDescription)) {
      const tons = row.metadataMatches === 1
        ? calculateInstalledRebarTons(row.quantity, row.uom, lineDescription)
        : null;
      if (tons === null) {
        quantity.rebarUncalculatedCount += 1;
        crew.rebarUncalculatedEntries += 1;
      } else {
        quantity.rebarTons = (quantity.rebarTons || 0) + tons;
        crew.rebarTons += tons;
        crew.rebarCalculatedEntries += 1;
      }
    }
    if (row.metadataMatches !== 1 || classifyProductivityCompletionLine(row) !== 'concrete') continue;
    const code = (row.costCode || '').trim().toUpperCase().replace(/\.[A-Z]+$/, '');
    const workType = concreteCodes[code] || classifyConcreteGroup({ name: row.description });
    if (!/^(CY|CU_YD|CU YD|CYD|CUBIC YARDS?)$/.test(normalizedUnit)) continue;
    crew.concrete += row.quantity;
    if (workType) getRate(crew, projectKey, row.projectId, projectName, workType).concrete += row.quantity;
    else warn('Concrete quantity has no resolved work type; it is not compared with labor hours.');
  }

  const scores = [...crews.values()].map(crew => {
    for (const day of crew.dayMap.values()) {
      if (day.date >= today || !day.projectId || crew.id === 'unattributed') continue;
      if (day.hours > 0 && day.logCount === 0) crew.review.push({
        kind: 'quantity-log', date: day.date, projectId: day.projectId, projectName: day.projectName,
        message: 'Hours recorded, but no field log from this submitter. Confirm whether quantity reporting was expected.',
      });
      if (day.logCount > 0 && day.hours === 0) crew.review.push({
        kind: 'timecards', date: day.date, projectId: day.projectId, projectName: day.projectName,
        message: 'Field logs recorded, but no timecard or daily-log labor hours from this submitter. Check for another submitter or missing time.',
      });
      if (day.timecardHours > 0 && day.logHours > 0) crew.review.push({
        kind: 'hours-overlap', date: day.date, projectId: day.projectId, projectName: day.projectName,
        message: 'Hours came from both timecards and daily-log labor items. Confirm the same crew time was not entered twice.',
      });
    }
    for (const rate of crew.rateMap.values()) {
      const estimate = selectCrewEstimate(rate.projectId ? projects.get(rate.projectId) : undefined, input.estimates);
      const estimatedHours = estimate?.pmcGroup[laborGroups[rate.workType]];
      const estimatedQuantity = estimate?.concreteGroup[rate.workType];
      if (finite(estimatedHours) && estimatedHours > 0 && finite(estimatedQuantity) && estimatedQuantity > 0) {
        rate.estimatedRate = estimatedQuantity / estimatedHours;
        rate.estimateName = estimate?.proposalName || estimate?.selectedProposalId || null;
      }
      if (crew.id === 'unattributed') rate.reason = 'Submitter attribution is missing.';
      else if (!rate.projectId) rate.reason = 'The project link is missing.';
      else if (rate.hours <= 0) rate.reason = 'No positive field hours for this work type.';
      else if (rate.concrete <= 0) rate.reason = 'No positive concrete quantity for this work type.';
      else if (crew.review.some(item => item.kind === 'source' && item.projectId === rate.projectId)) rate.reason = 'Resolve this project\'s source-data questions before comparing pace.';
      // Past hours-only days (prep, forming, stripping) stay in the denominator; they can only lower pace.
      // Logs without hours, or an unfinished day, could overstate pace, so those still withhold the rate.
      else if ([...crew.dayMap.values()].some(day => day.projectId === rate.projectId
        && ((day.logCount > 0 && day.hours <= 0) || (day.date >= today && (day.hours > 0) !== (day.logCount > 0))))) rate.reason = 'Field logs without matching field hours, or an unfinished day, on this project.';
      else if (crew.review.some(item => item.kind === 'hours-overlap' && item.projectId === rate.projectId)) rate.reason = 'Resolve possible duplicate timecard and daily-log hours before comparing pace.';
      else rate.actualRate = rate.concrete / rate.hours;
      if (rate.estimatedRate === null && !rate.reason) rate.reason = estimate
        ? 'The selected estimate has no positive matching concrete quantity and labor hours.'
        : 'No unambiguous selected estimate is linked to this project.';
      if (rate.actualRate !== null && rate.estimatedRate !== null) rate.percentOfEstimate = rate.actualRate / rate.estimatedRate * 100;
    }
    const { workerIds, dayMap, quantityMap, rateMap, ...score } = crew;
    return { ...score, workers: workerIds.size,
      days: [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date) || a.projectName.localeCompare(b.projectName)),
      quantities: [...quantityMap.values()].sort((a, b) => a.projectName.localeCompare(b.projectName) || a.description.localeCompare(b.description)),
      rates: [...rateMap.values()].sort((a, b) => a.projectName.localeCompare(b.projectName) || a.workType.localeCompare(b.workType)),
      review: [...new Map(score.review.map(item => [JSON.stringify(item), item])).values()].sort((a, b) => a.date.localeCompare(b.date)),
    };
  }).sort((a, b) => Number(b.isForeman) - Number(a.isForeman) || a.name.localeCompare(b.name));
  return { companyId: input.companyId, week: input.week, through, today, loadedAt: now.toISOString(),
    newestTimecardDate, newestLogDate, foremanCount: identities.known.length, excluded, crews: scores };
}

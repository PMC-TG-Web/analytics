export const KPI_WIN_RATE_COMPANIES = ['598134325805519', '598134325658789'] as const;
export const KPI_WIN_RATE_POLICY_KEY = 'kpi-win-rate:project-groups';
export const KPI_WIN_RATE_START_YEAR = 2026;
export const KPI_WIN_RATE_BASELINE_KEY = 'kpi-win-rate:old-instance-baseline';
export const KPI_CURRENT_COMPANY = KPI_WIN_RATE_COMPANIES[0];
export const KPI_OLD_COMPANY = KPI_WIN_RATE_COMPANIES[1];

export type WinRateBid = {
  companyId: string;
  bidBoardId: string;
  projectName: string;
  status: string | null;
  payload: unknown;
};
export type WinRateBaseline = {
  version: 1;
  companyId: typeof KPI_OLD_COMPANY;
  savedAt: string;
  bids: WinRateBid[];
};

// Keep project-level history, not only totals, so migration copies can still be
// deduplicated and an old bid won in the new instance advances the same project.
export function createWinRateBaseline(rows: WinRateBid[], savedAt = new Date()): WinRateBaseline {
  const bids = new Map<string, WinRateBid>();
  for (const row of rows) {
    if (row.companyId !== KPI_OLD_COMPANY || row.bidBoardId.includes(':')) continue;
    const p = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {};
    bids.set(row.bidBoardId, {
      companyId: KPI_OLD_COMPANY, bidBoardId: row.bidBoardId,
      projectName: row.projectName, status: row.status,
      payload: {
        created_on: p.created_on ?? null, status: p.status ?? row.status,
        archived: Boolean(p.archived), deleted: Boolean(p.deleted),
        is_template: Boolean(p.is_template), sync_missing_from_procore: Boolean(p.sync_missing_from_procore),
      },
    });
  }
  if (bids.size === 0) throw new Error('Cannot save an empty old-instance baseline.');
  return { version: 1, companyId: KPI_OLD_COMPANY, savedAt: savedAt.toISOString(), bids: [...bids.values()] };
}

export function parseWinRateBaseline(value: string): WinRateBaseline {
  const baseline = JSON.parse(value) as WinRateBaseline;
  if (baseline?.version !== 1 || baseline.companyId !== KPI_OLD_COMPANY
    || !Number.isFinite(Date.parse(baseline.savedAt)) || !Array.isArray(baseline.bids) || baseline.bids.length === 0
    || baseline.bids.some(b => b.companyId !== KPI_OLD_COMPANY || typeof b.bidBoardId !== 'string' || typeof b.projectName !== 'string')) {
    throw new Error('Invalid saved old-instance baseline.');
  }
  return baseline;
}

export function combineWinRateSources(currentRows: WinRateBid[], baseline: WinRateBaseline): WinRateBid[] {
  // Never read old-instance live mirrors into this calculation after freezing.
  return [...baseline.bids, ...currentRows.filter(row => row.companyId === KPI_CURRENT_COMPANY)];
}
export type WinRateGroupRule = {
  key: string;
  names: string[];
  preferredSource: string;
  sourceIds?: string[];
  createdDate: string;
};
export type WinRatePolicy = {
  groups: WinRateGroupRule[];
  excludedSources: string[];
};
export type WinRateProject = {
  key: string;
  name: string;
  createdDate: string;
  status: string;
  won: boolean;
  bid: boolean;
  sources: { companyId: string; bidBoardId: string; status: string }[];
};
export type WinRateCount = { won: number; bid: number; total: number; estimating: number; rate: number | null };
export type WinRateReport = {
  months: (WinRateCount | null)[];
  total: WinRateCount;
  projects: WinRateProject[];
  years: number[];
  missingCreatedDates: number;
  asOf: string;
};

// Reporting grouping only: this never changes canonical Procore project IDs.
// Customer is deliberately absent: several contractors can bid the same job.
export function winRateName(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}
export function mergeWinRateGroups(input: WinRateGroupRule[]): WinRateGroupRule[] {
  let groups: WinRateGroupRule[] = [];
  const identifiers = (g: WinRateGroupRule) => new Set([
    ...g.names.map(n => `name:${winRateName(n)}`),
    ...[g.preferredSource, ...(g.sourceIds ?? [])].map(id => `source:${id}`),
  ]);
  for (const row of input) {
    const keys = identifiers(row);
    const matches = groups.filter(g => [...identifiers(g)].some(key => keys.has(key)));
    const joined = [row, ...matches].sort((a, b) => a.createdDate.localeCompare(b.createdDate) || a.key.localeCompare(b.key));
    const merged = {
      ...joined[0],
      names: [...new Set(joined.flatMap(g => g.names))],
      sourceIds: [...new Set(joined.flatMap(g => [g.preferredSource, ...(g.sourceIds ?? [])]))],
    };
    groups = [...groups.filter(g => !matches.includes(g)), merged];
  }
  return groups;
}
export function winRateStatus(value: unknown): string {
  return String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}
const wonStatuses = new Set(['ACCEPTED', 'IN_PROGRESS', 'COMPLETE']);
function count(projects: WinRateProject[]): WinRateCount {
  const won = projects.filter(p => p.won).length;
  const bid = projects.filter(p => p.bid).length;
  return { won, bid, total: projects.length, estimating: projects.length - bid, rate: bid ? won / bid : null };
}

export function calculateWinRate(
  bids: WinRateBid[],
  policy: WinRatePolicy = { groups: [], excludedSources: [] },
  year: number | null = null,
  asOf = new Date(),
): WinRateReport {
  const rules = mergeWinRateGroups(policy.groups);
  const byName = new Map(rules.flatMap(g => g.names.map(n => [winRateName(n), g] as const)));
  const bySource = new Map(rules.flatMap(g => [...new Set([g.preferredSource, ...(g.sourceIds ?? [])])].map(source => [source, g] as const)));
  const excluded = new Set(policy.excludedSources);
  const groups = new Map<string, { rule?: WinRateGroupRule; rows: (WinRateBid & { date: string; state: string })[] }>();
  let missingCreatedDates = 0;
  for (const row of bids) {
    if (!KPI_WIN_RATE_COMPANIES.includes(row.companyId as typeof KPI_WIN_RATE_COMPANIES[number]) || row.bidBoardId.includes(':')) continue;
    const source = `${row.companyId}:${row.bidBoardId}`;
    if (excluded.has(source)) continue;
    const p = row.payload && typeof row.payload === 'object' ? row.payload as Record<string, unknown> : {};
    const state = winRateStatus(p.status ?? row.status);
    // The workbook uses the active bid list, not archived projects or invitations.
    if (p.archived || p.deleted || p.is_template || p.sync_missing_from_procore || state === 'INVITATION' || state === 'INVITATIONS') continue;
    const rule = bySource.get(source) ?? byName.get(winRateName(row.projectName));
    const date = String(p.created_on ?? '');
    if (!rule && (!date || !Number.isFinite(Date.parse(date)))) { missingCreatedDates++; continue; }
    const key = rule?.key ?? (winRateName(row.projectName) || source);
    const group = groups.get(key) ?? { rule, rows: [] };
    group.rows.push({ ...row, date, state });
    groups.set(key, group);
  }
  const all: WinRateProject[] = [];
  for (const [key, { rule, rows }] of groups) {
    // Preserve the owner's selected Created Date across migration copies.
    // Unreviewed new groups use their earliest source Created Date.
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.bidBoardId.localeCompare(b.bidBoardId));
    const preferred = rows.find(r => `${r.companyId}:${r.bidBoardId}` === rule?.preferredSource) ?? rows[0];
    const winner = rows.find(r => wonStatuses.has(r.state));
    const qualifying = winner ?? rows.find(r => r.state !== 'ESTIMATING') ?? preferred;
    const createdDate = rule?.createdDate ?? preferred.date;
    if (!Number.isFinite(Date.parse(createdDate))) { missingCreatedDates++; continue; }
    // Apply the reporting start after deduplication so a 2025 project copied
    // into the current instance in 2026 does not become a new 2026 bid.
    if (Number(createdDate.slice(0, 4)) < KPI_WIN_RATE_START_YEAR) continue;
    all.push({ key, name: preferred.projectName, createdDate, status: qualifying.state.replace(/_/g, ' '), won: Boolean(winner), bid: qualifying.state !== 'ESTIMATING', sources: rows.map(r => ({ companyId: r.companyId, bidBoardId: r.bidBoardId, status: r.state.replace(/_/g, ' ') })) });
  }
  all.sort((a, b) => a.createdDate.localeCompare(b.createdDate) || a.name.localeCompare(b.name));
  const projects = all.filter(p => year === null || Number(p.createdDate.slice(0, 4)) === year);
  const currentYear = asOf.getUTCFullYear();
  const currentMonth = asOf.getUTCMonth() + 1;
  const months = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    if (year !== null && (year > currentYear || (year === currentYear && month > currentMonth))) return null;
    return count(projects.filter(p => Number(p.createdDate.slice(5, 7)) <= month));
  });
  return { months, total: count(projects), projects, years: [...new Set(all.map(p => Number(p.createdDate.slice(0, 4))))].sort(), missingCreatedDates, asOf: asOf.toISOString() };
}


export type WipReportLink = { companyId: string; projectId: string; mode: 'procore' | 'history' };
export type WipReportLine = { row: number; soldDate: string | null; month: string; percent: number; hours: number; revenue: number; projectHours: number; contractValue: number | null };
export type WipReportProject = {
  id: string; sourceName: string; projectName: string; customer: string;
  link: WipReportLink | null; lines: WipReportLine[]; issues: string[];
};
export type WipReportSnapshot = { version: 1; companyId: string; sourceFile: string; sourceHash: string; importedAt: string; importedBy: string; projects: WipReportProject[] };
export const wipReportKey = (companyId: string) => `wip:legacy-projects:${companyId}`;
export const reportNameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

function excelDate(value: unknown): string {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 36526 || value > 73050) throw new Error('Expected an Excel calendar date between 2000 and 2099.');
  return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
}

/** The workbook has no external IDs. Only a separately reviewed mapping may link its names to Procore. */
export function parseWipRevenueReport(rows: unknown[][], companyId: string, mapping: Record<string, WipReportLink>): WipReportProject[] {
  const expected = ['customer/project name', 'job sold date', 'project hours', 'contract total', 'start date', '% of', 'contract total', 'project hours'];
  if (JSON.stringify(rows[0]?.map(value => String(value || '').trim().toLowerCase())) !== JSON.stringify(expected)) throw new Error('Unexpected WIP revenue workbook columns.');
  const groups = new Map<string, WipReportProject>();
  const reviewed = new Map(Object.entries(mapping).map(([name, link]) => [reportNameKey(name), link]));
  for (let index = 1; index < rows.length; index++) {
    const row = rows[index];
    if (row.every(value => value === null || value === '')) continue;
    const name = String(row[0] || '').trim(), key = reportNameKey(name);
    if (!name) throw new Error(`Missing project at row ${index + 1}.`);
    const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const revenue = row[6] === null && number(row[3]) && number(row[5]) ? Number(row[3]) * Number(row[5]) : row[6];
    if (![row[2], row[5], revenue].every(number) || Number(row[5]) > 1 || (row[3] !== null && !number(row[3]))) throw new Error(`Invalid hours, value, or percentage at row ${index + 1}.`);
    const allocatedHours = row[7] === '' && row[5] === 0 ? 0 : row[7];
    if (!number(allocatedHours)) throw new Error(`Missing allocated hours at row ${index + 1}.`);
    if (Math.abs(Number(allocatedHours) - Number(row[2]) * Number(row[5])) > 0.01
      || (row[3] !== null && Math.abs(Number(revenue) - Number(row[3]) * Number(row[5])) > 0.01)) throw new Error(`Monthly values do not reconcile at row ${index + 1}.`);
    if (!groups.has(key)) {
      const slash = name.indexOf('/');
      groups.set(key, { id: `report:${companyId}:${encodeURIComponent(key)}`, sourceName: name, customer: slash < 0 ? '' : name.slice(0, slash), projectName: slash < 0 ? name : name.slice(slash + 1), link: reviewed.get(key) || null, lines: [], issues: [] });
    }
    groups.get(key)!.lines.push({ row: index + 1, soldDate: row[1] === null ? null : excelDate(row[1]), month: excelDate(row[4]).slice(0, 7), projectHours: Number(row[2]), contractValue: row[3] === null ? null : Number(row[3]), percent: Number(row[5]) * 100, revenue: Number(revenue), hours: Number(allocatedHours) });
    if (row[6] === null) groups.get(key)!.issues.push(`Row ${index + 1}: blank monthly revenue calculated from supplied contract value × percentage.`);
  }
  for (const project of groups.values()) {
    const total = project.lines.reduce((sum, line) => sum + line.percent, 0);
    if (Math.abs(total - 100) > 0.00001) project.issues.push(`Report covers ${Math.round(total * 100) / 100}% across the supplied months; preserved as reported.`);
    if (new Set(project.lines.map(line => `${line.soldDate}:${line.projectHours}:${line.contractValue}`)).size > 1) project.issues.push('Hours, contract value, or sold date differ between source rows; monthly amounts are preserved.');
    if (project.lines.some(line => line.contractValue === null)) project.issues.push('Some source rows have no contract value; their reported revenue is preserved.');
  }
  for (const key of reviewed.keys()) if (!groups.has(key)) throw new Error(`Reviewed mapping not found in report: ${key}`);
  return [...groups.values()].sort((a, b) => a.sourceName.localeCompare(b.sourceName));
}

export function supplementalWipProjects(snapshot: WipReportSnapshot | null, occupiedProjectIds: string[]): WipReportProject[] {
  const occupied = new Set(occupiedProjectIds);
  return (snapshot?.projects || []).filter(project => project.link?.mode !== 'procore'
    && !(project.link?.companyId === snapshot?.companyId && occupied.has(project.link.projectId)));
}

export function reportMonthValues(project: WipReportProject, month: string) {
  return project.lines.filter(line => line.month === month).reduce((total, line) => ({ hours: total.hours + line.hours, revenue: total.revenue + line.revenue, percent: total.percent + line.percent }), { hours: 0, revenue: 0, percent: 0 });
}

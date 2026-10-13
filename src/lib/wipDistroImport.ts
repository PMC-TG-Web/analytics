import { allocationPercent, validateWipAllocations, type WipProject, type WipAllocation } from './wipPlanning.ts';
import type { WipLocalStore } from './wipLocalStore.ts';

export const distroNameKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

/** This export has no external IDs. A reviewed, explicit ID mapping is required. */
export function prepareWipDistroImport(rows: unknown[][], projects: WipProject[], mapping: Record<string, string>, companyId: string, actor: string, now: string, excludedRows: number[] = []) {
  const headers = (rows[0] || []).map(value => String(value ?? '').trim());
  const column = (names: string[]) => {
    const indices = headers.flatMap((value, index) => names.includes(value) ? [index] : []);
    if (indices.length !== 1) throw new Error(`Expected exactly one ${names.join(' or ')} column.`);
    return indices[0];
  };
  const nameColumn = column(['Customer/Project Name']);
  const dateColumn = column(['WIP Distro Dates', 'Distro Dates']);
  const percentColumn = column(['% of']);
  const groups = new Map<string, { name: string; rows: number[]; months: Map<string, number> }>();
  if (excludedRows.some(row => !Number.isInteger(row) || row < 2 || row > rows.length)) throw new Error('Invalid excluded source row.');
  rows.slice(1).forEach((row, index) => {
    if (excludedRows.includes(index + 2)) return;
    if (row.every(value => value === null || value === undefined || value === '')) return;
    const name = row[nameColumn], serial = row[dateColumn], fraction = row[percentColumn];
    if (typeof name !== 'string' || !name.trim() || typeof serial !== 'number' || !Number.isInteger(serial)
      || typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1
      || Math.abs(fraction * 10000 - Math.round(fraction * 10000)) > 0.000001) throw new Error(`Invalid source name, date, or percentage at row ${index + 2}.`);
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2099) throw new Error(`Invalid year at row ${index + 2}.`);
    const month = date.toISOString().slice(0, 7);
    const key = distroNameKey(name);
    const group = groups.get(key) || { name: name.trim(), rows: [], months: new Map<string, number>() };
    group.rows.push(index + 2);
    group.months.set(month, (group.months.get(month) || 0) + Math.round(fraction * 10000));
    groups.set(key, group);
  });
  const mapped = new Map(Object.entries(mapping).map(([name, id]) => [distroNameKey(name), id]));
  if (mapped.size !== Object.keys(mapping).length) throw new Error('Duplicate mapping names.');
  for (const name of mapped.keys()) if (!groups.has(name)) throw new Error(`Mapping is absent from the report: ${name}`);
  const store: WipLocalStore = { version: 1, companyId, plans: {}, drafts: {}, history: {} };
  const seen = new Set<string>();
  const report: { sourceName: string; sourceRows: number[]; projectId: string | null; projectName?: string; totalPercent: number; allocations: WipAllocation[]; status: string }[] = [];
  for (const [name, group] of groups) {
    const allocations: WipAllocation[] = [...group.months].filter(([, value]) => value > 0).map(([month, value]) => ({ month, percent: value / 100 })).sort((a, b) => a.month.localeCompare(b.month));
    const projectId = mapped.get(name);
    const totalPercent = allocationPercent(allocations);
    const result = { sourceName: group.name, sourceRows: group.rows, projectId: projectId || null, totalPercent, allocations };
    if (!projectId) { report.push({ ...result, status: 'Not mapped to an active WIP job' }); continue; }
    const candidates = projects.filter(project => project.projectId === projectId);
    if (candidates.length !== 1 || candidates[0].issue || candidates[0].plan || seen.has(projectId)) throw new Error(`Target is missing, ambiguous, already planned, or mapped twice: ${group.name}`);
    seen.add(projectId);
    const project = candidates[0];
    const notes = `Imported from WIP Distro.xlsx: ${group.name}.`;
    let valid = true;
    try { validateWipAllocations(allocations); } catch { valid = false; }
    if (valid) {
      const data = { source: project.source, allocations, notes, revision: 1 };
      store.plans[projectId] = { ...data, updatedBy: actor, updatedAt: now };
      store.history[projectId] = [{ ...data, createdBy: actor, createdAt: now }];
    } else store.drafts[projectId] = { allocations, notes, sourceName: group.name };
    report.push({ ...result, projectName: project.projectName, status: valid ? 'Loaded' : 'Import needs review' });
  }
  return { store, report };
}

import type { SteelProject } from './steelNeeds.ts';
import { steelBundleSize } from './steelBundles.ts';

/** Inclusive Eastern calendar days as YYYY-MM-DD. An empty end leaves that side open. */
export type SteelOrderRange = { from: string; to: string };
export type SteelOrderExportRow = {
  /** Total adds up one material across jobs; Job is one job's share of it. */
  type: 'Total' | 'Job'; description: string; kind: string; unit: string; quantity: number;
  bundles: number | null; piecesPerBundle: number | null; projectNumber: string; projectName: string;
  jobs: number; days: string[]; recordedBy: string[]; corrected: boolean;
};

const easternDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York' });
/** The Eastern calendar day of a saved timestamp, as YYYY-MM-DD. */
export const steelEasternDay = (timestamp: string | Date) => easternDay.format(new Date(timestamp));
const usDay = (day: string) => `${day.slice(5, 7)}/${day.slice(8, 10)}/${day.slice(0, 4)}`;
const round = (value: number) => Math.round(value * 10000) / 10000;

export function steelOrderRangeLabel(range: SteelOrderRange): string {
  if (range.from && range.to) return range.from === range.to ? usDay(range.from) : `${usDay(range.from)} to ${usDay(range.to)}`;
  return range.from ? `From ${usDay(range.from)}` : range.to ? `Through ${usDay(range.to)}` : 'All dates';
}

/**
 * What was ordered in a date range: order-log lines by the Eastern day they were recorded, undone lines left out.
 * Total corrections count toward the net and are flagged. Totals saved before the log have no date and cannot be included.
 */
export function steelOrdersInRange(projects: SteelProject[], range: SteelOrderRange) {
  const valid = !range.from || !range.to || range.from <= range.to;
  const materials = new Map<string, SteelOrderExportRow[]>();
  const jobs = new Set<string>();
  let orders = 0;
  for (const project of valid ? projects : []) for (const item of project.items) {
    const lines = (item.log || []).filter(entry => {
      if (entry.voidedAt) return false;
      const day = steelEasternDay(entry.createdAt);
      return (!range.from || day >= range.from) && (!range.to || day <= range.to);
    });
    const quantity = round(lines.reduce((sum, entry) => sum + entry.quantity, 0));
    if (!lines.length || !quantity) continue;
    orders += lines.length; jobs.add(project.key);
    const piecesPerBundle = steelBundleSize(item);
    materials.set(item.key, [...(materials.get(item.key) || []), {
      type: 'Job', description: item.description, kind: item.kind, unit: item.unit, quantity, piecesPerBundle,
      bundles: piecesPerBundle ? round(quantity / piecesPerBundle) : null, projectNumber: project.projectNumber, projectName: project.projectName, jobs: 1,
      days: [...new Set(lines.map(entry => steelEasternDay(entry.createdAt)))].sort(), recordedBy: [...new Set(lines.map(entry => entry.createdBy))].sort(),
      corrected: lines.some(entry => entry.kind === 'correction'),
    }]);
  }
  const rows = [...materials.values()].flatMap(jobRows => {
    const [first] = jobRows, quantity = round(jobRows.reduce((sum, row) => sum + row.quantity, 0));
    const total: SteelOrderExportRow = { ...first, type: 'Total', quantity, bundles: first.piecesPerBundle ? round(quantity / first.piecesPerBundle) : null,
      projectNumber: '', projectName: `All jobs (${jobRows.length})`, jobs: jobRows.length,
      days: [...new Set(jobRows.flatMap(row => row.days))].sort(), recordedBy: [...new Set(jobRows.flatMap(row => row.recordedBy))].sort(), corrected: jobRows.some(row => row.corrected) };
    return [total, ...jobRows.sort((a, b) => a.projectName.localeCompare(b.projectName) || a.projectNumber.localeCompare(b.projectNumber))];
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.description.localeCompare(b.description) || a.unit.localeCompare(b.unit));
  return { rows, orders, jobs: jobs.size, valid };
}

export function steelOrdersCsv(projects: SteelProject[], range: SteelOrderRange, scope: string, loadedAt: string): string {
  const header = ['Row', 'Material', 'Unit', 'Quantity ordered', 'Bundles', 'Pieces per bundle', 'Job number', 'Job', 'Order dates (Eastern)', 'Recorded by', 'Notes', 'Order date range (Eastern)', 'Filter scope', 'Data read at'];
  const bundles = (value: number | null) => value === null ? '' : Math.round(value * 100) / 100;
  const rows: unknown[][] = [header, ...steelOrdersInRange(projects, range).rows.map(row => [row.type, row.description, row.unit, row.quantity, bundles(row.bundles), row.piecesPerBundle ?? '',
    row.projectNumber, row.projectName, row.days.map(usDay).join('; '), row.recordedBy.join('; '), row.corrected ? 'Includes a total correction' : '', steelOrderRangeLabel(range), scope, loadedAt])];
  // Text that a spreadsheet could read as a formula is neutralized; real numbers, including negative corrections, stay numbers.
  return '\uFEFF' + rows.map(row => row.map(value => {
    const text = String(value ?? '');
    return `"${(typeof value !== 'number' && /^[=+\-@\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
}

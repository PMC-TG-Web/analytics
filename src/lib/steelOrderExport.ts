import type { SteelItem, SteelProject } from './steelNeeds.ts';
import { steelBundleSize } from './steelBundles.ts';

/** Inclusive Eastern calendar days as YYYY-MM-DD. An empty end leaves that side open. */
export type SteelOrderRange = { from: string; to: string };
/** One job's orders of one material in the range. */
export type SteelOrderExportRow = {
  description: string; kind: SteelItem['kind']; unit: string; quantity: number; bundles: number | null;
  projectNumber: string; projectName: string; days: string[];
};

const easternDay = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York' });
/** The Eastern calendar day of a saved timestamp, as YYYY-MM-DD. */
export const steelEasternDay = (timestamp: string | Date) => easternDay.format(new Date(timestamp));
const usDay = (day: string) => `${day.slice(5, 7)}/${day.slice(8, 10)}/${day.slice(0, 4)}`;
const round = (value: number) => Math.round(value * 10000) / 10000;

/**
 * What was ordered in a date range: order-log lines by the Eastern day they were recorded, undone lines left out.
 * Total corrections count toward the net. Totals saved before the log have no date and cannot be included.
 */
export function steelOrdersInRange(projects: SteelProject[], range: SteelOrderRange) {
  const valid = !range.from || !range.to || range.from <= range.to;
  const rows: SteelOrderExportRow[] = [];
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
    rows.push({ description: item.description, kind: item.kind, unit: item.unit, quantity, bundles: piecesPerBundle ? round(quantity / piecesPerBundle) : null,
      projectNumber: project.projectNumber, projectName: project.projectName, days: [...new Set(lines.map(entry => steelEasternDay(entry.createdAt)))].sort() });
  }
  rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.description.localeCompare(b.description) || a.unit.localeCompare(b.unit)
    || a.projectName.localeCompare(b.projectName) || a.projectNumber.localeCompare(b.projectNumber));
  return { rows, orders, jobs: jobs.size, valid };
}

/** Job details first, then five blank rows and a separate totals-by-material table. */
export function steelOrdersCsv(projects: SteelProject[], range: SteelOrderRange): string {
  const orders = steelOrdersInRange(projects, range).rows;
  const rows: unknown[][] = [['Material', 'Unit', 'Quantity ordered', 'Bundles', 'Job number', 'Job', 'Order date'],
    ...orders.map(row => [row.description, row.unit, row.quantity, row.bundles === null ? '' : Math.round(row.bundles * 100) / 100,
      row.projectNumber, row.projectName, row.days.map(usDay).join('; ')])];
  if (orders.length) {
    const totals = new Map<string, SteelOrderExportRow>();
    for (const row of orders) {
      const key = JSON.stringify([row.kind, row.description, row.unit]);
      const total = totals.get(key);
      if (total) total.quantity = round(total.quantity + row.quantity);
      else totals.set(key, { ...row });
    }
    rows.push(...Array.from({ length: 5 }, () => []), ['Material totals', 'Unit', 'Quantity ordered', 'Bundles', '', '', '']);
    for (const total of totals.values()) {
      const piecesPerBundle = steelBundleSize(total);
      // Convert the combined quantity, rather than adding the rounded job bundle figures.
      rows.push([total.description, total.unit, total.quantity, piecesPerBundle ? Math.round(total.quantity / piecesPerBundle * 100) / 100 : '', '', '', '']);
    }
  }
  // Text that a spreadsheet could read as a formula is neutralized; real numbers, including negative corrections, stay numbers.
  return '\uFEFF' + rows.map(row => row.map(value => {
    const text = String(value ?? '');
    return `"${(typeof value !== 'number' && /^[=+\-@\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
}

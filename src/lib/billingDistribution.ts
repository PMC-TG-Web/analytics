import type { BillingHourRow } from './billingAnalytics.ts';

export type BillingMonthGroup = { month: string; projects: BillingProjectGroup[]; totalHours: number };
export type BillingProjectGroup = { projectId: string; projectName: string; projectNumber: string; rows: BillingHourRow[]; totalHours: number };

/** Display groups preserve canonical IDs even when projects have the same name. */
export function groupBillingYear(rows: BillingHourRow[], year: number): BillingMonthGroup[] {
  return Array.from({ length: 12 }, (_, index) => {
    const month = `${year}-${String(index + 1).padStart(2, '0')}`;
    const projects = new Map<string, BillingProjectGroup>();
    for (const row of rows.filter(row => row.month === month)) {
      const project = projects.get(row.projectId) || { projectId: row.projectId, projectName: row.projectName, projectNumber: row.projectNumber, rows: [], totalHours: 0 };
      project.rows.push(row);
      project.totalHours += row.totalHours;
      projects.set(row.projectId, project);
    }
    for (const project of projects.values()) project.rows.sort((a, b) => a.costCode.localeCompare(b.costCode));
    return { month, projects: [...projects.values()].sort((a, b) => a.projectName.localeCompare(b.projectName) || a.projectId.localeCompare(b.projectId)),
      totalHours: [...projects.values()].reduce((sum, project) => sum + project.totalHours, 0) };
  });
}

export type BillingDistributionLine = { row: BillingHourRow; projectShare: number; invoiceShare: number; cents: number | null };
export type BillingDistribution = { lines: BillingDistributionLine[]; totalHours: number; invoiceCents: number | null; error: string | null };

function invoiceCents(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Enter a positive invoice amount with no more than two decimal places.');
  const [whole, fraction = ''] = text.split('.');
  const cents = Number(BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, '0')));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 999999999999) throw new Error('Enter an invoice amount between $0.01 and $9,999,999,999.99.');
  return cents;
}

/** One month's explicitly selected projects; display filters never change the denominator.
 * Integer weights at the report's four-decimal hour precision and largest remainders
 * make the sum exact to the cent, with deterministic ties independent of display order.
 */
export function distributeBillingInvoice(rows: BillingHourRow[], projectIds: string[], amount = ''): BillingDistribution {
  try {
    const selected = new Set(projectIds);
    if (!selected.size) throw new Error('Select at least one project covered by this invoice.');
    if ([...selected].some(id => !rows.some(row => row.projectId === id))) throw new Error('A selected project has no hours in this month.');
    const eligible = rows.filter(row => selected.has(row.projectId));
    if (new Set(eligible.map(row => row.month)).size !== 1) throw new Error('Allocate one work month at a time.');
    if (new Set(eligible.map(row => row.key)).size !== eligible.length) throw new Error('Duplicate cost-code rows need review before allocation.');
    if (eligible.some(row => !row.costCode.trim() || row.costCode === '(Unassigned)')) throw new Error('Resolve unassigned cost codes in the selected projects before allocating.');
    const weights = eligible.map(row => {
      const scaled = Math.round(row.totalHours * 10000);
      if (!Number.isSafeInteger(scaled) || row.totalHours < 0) throw new Error('Review negative or invalid hours in the selected projects before allocating.');
      return BigInt(scaled);
    });
    const total = weights.reduce((sum, weight) => sum + weight, BigInt(0));
    if (total <= BigInt(0)) throw new Error('The selected projects need positive hours to distribute an invoice.');
    const projectTotals = new Map<string, bigint>();
    eligible.forEach((row, index) => projectTotals.set(row.projectId, (projectTotals.get(row.projectId) || BigInt(0)) + weights[index]));
    const cents = invoiceCents(amount);
    const allocations = weights.map(weight => cents === null ? null : BigInt(cents) * weight / total);
    if (cents !== null) {
      const remainderOrder = eligible.map((row, index) => ({ index, key: row.key, remainder: BigInt(cents) * weights[index] % total }))
        .sort((a, b) => a.remainder === b.remainder ? (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) : a.remainder > b.remainder ? -1 : 1);
      const remaining = BigInt(cents) - allocations.reduce<bigint>((sum, value) => sum + (value || BigInt(0)), BigInt(0));
      for (let i = 0; i < Number(remaining); i++) allocations[remainderOrder[i].index]! += BigInt(1);
    }
    return { invoiceCents: cents, totalHours: Number(total) / 10000, error: null,
      lines: eligible.map((row, index) => ({ row, projectShare: Number(weights[index]) / Number(projectTotals.get(row.projectId) || BigInt(1)),
        invoiceShare: Number(weights[index]) / Number(total), cents: allocations[index] === null ? null : Number(allocations[index]) })) };
  } catch (error) {
    return { lines: [], totalHours: 0, invoiceCents: null, error: error instanceof Error ? error.message : 'Unable to distribute invoice.' };
  }
}

export function billingDistributionCsv(distribution: BillingDistribution, reference: string): string {
  if (distribution.error || distribution.invoiceCents === null) throw new Error(distribution.error || 'Enter the invoice amount before exporting its distribution.');
  const cell = (value: string | number) => `"${String(typeof value === 'string' && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;
  return [['Invoice reference', 'Work month', 'Project ID', 'Project number', 'Project', 'Cost code', 'Description', 'Timesheet hours', 'Productivity hours', 'Combined hours', '% of project hours', '% of invoice hours', 'Allocated cost (USD)', 'Invoice total (USD)'],
    ...distribution.lines.map(({ row, projectShare, invoiceShare, cents }) => [reference, row.month, row.projectId, row.projectNumber, row.projectName, row.costCode, row.costCodeName,
      row.timesheetHours, row.productivityHours, row.totalHours, (projectShare * 100).toFixed(4), (invoiceShare * 100).toFixed(4), (cents! / 100).toFixed(2), (distribution.invoiceCents! / 100).toFixed(2)])]
    .map(row => row.map(cell).join(',')).join('\r\n');
}

import { aggregateSteelNeeds, steelOrderQuantities, steelOrderedDate, type SteelProject } from './steelNeeds.ts';

export type SteelOrderList = 'all' | 'needed' | 'ordered';
export const steelOrderListLabels = { all: 'All materials', needed: 'Need to order', ordered: 'Ordered' };

export function steelOrderWorksheet(projects: SteelProject[], list: SteelOrderList) {
  return aggregateSteelNeeds(projects).filter(item => list === 'all' || (list === 'ordered' ? item.orderedQuantity : item.toOrderQuantity) > 0)
    .map(item => ({ ...item, projects: item.projects.filter(row => list === 'all' || (list === 'ordered' ? steelOrderQuantities(row).orderedQuantity : steelOrderQuantities(row).toOrderQuantity) > 0) }));
}

export function steelOrderWorksheetCsv(projects: SteelProject[], list: SteelOrderList, scope: string, loadedAt: string): string {
  const rows: unknown[][] = [list === 'all'
    ? ['Description', 'Unit', 'Full estimate', 'Ordered quantity', 'Need to order', 'Projects', 'Order dates (Eastern)', 'Review', 'Filter scope', 'Data read at']
    : ['Description', 'Unit', list === 'ordered' ? 'Ordered quantity' : 'Need to order', 'Projects', 'Order dates (Eastern)', 'Review', 'Filter scope', 'Data read at']];
  for (const item of steelOrderWorksheet(projects, list)) {
    const dates = [...new Set(item.projects.filter(row => row.order?.orderedAt).map(row => steelOrderedDate(row.order!.orderedAt!)))].sort();
    rows.push([item.description, item.unit,
      ...(list === 'all' ? [item.quantity, item.orderedQuantity, item.toOrderQuantity] : [list === 'ordered' ? item.orderedQuantity : item.toOrderQuantity]),
      item.projects.map(row => `${row.project.projectNumber ? `${row.project.projectNumber} · ` : ''}${row.project.projectName}`).join('; '), dates.join('; '),
      item.changedOrders ? 'Estimate changed since marked; review project quantities before ordering.' : '', scope, loadedAt]);
  }
  return '\uFEFF' + rows.map(row => row.map(value => {
    const text = String(value ?? '');
    return `"${(/^[=+\-@\t\r]/.test(text) ? "'" : '') + text.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
}

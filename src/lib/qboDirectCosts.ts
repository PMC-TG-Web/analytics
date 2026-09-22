import { Prisma } from '@prisma/client';
import { isShopDrawingCost } from './qboDirectCostExclusions.js';
import type { CatalogPriceEvidence } from './qboCostCatalog';

export const DIRECT_COST_VENDOR = 'PMC Procore Direct Costs';
// Concrete purchase quantities are tracked outside these internal-cost bills.
export const EXCLUDED_CONCRETE_COST_CODES = new Set([
  '03-300-00-20', // Foundation Concrete
  '03-300-10-20', // Wall Concrete
  '03-300-20-20', // Slab On Grade Concrete
  '03-300-30-20', // Site Concrete
  '05-100-10-20', // Concrete Set And Fill Bollards
]);
const EXCLUDED_PUMPING_ITEMS = new Set([
  'line dragon',
  'boom pump rental w/operator',
  'telebelt (4 hr minimum)',
  'trailer pump (includes 3 hr)',
]);
function isExcludedConcrete(item: DirectCostItem, sourceName: string) {
  const labor = /^(labor|l)$/i.test(item.costType?.trim() || '');
  if (labor && !/^(cy|cu\.?\s*yd|cubic\s*yards?)$/i.test(item.uom?.trim() || '')) return false;
  const code = (item.costCode || '').trim().replace(/\.[A-Z]+$/i, '');
  const name = (item.description?.trim() || sourceName).normalize('NFKC').toLowerCase()
    .replace(/^co\s*\d+\s*[-\u2013\u2014]\s*/, '').replace(/\s+/g, ' ').trim()
    .replace(/\s+-\s+(site|sog|foundation|foundations|wall)$/, '');
  return (!labor && EXCLUDED_CONCRETE_COST_CODES.has(code))
    || /^(site concrete|slab on grade concrete|foundation concrete|wall concrete|bollards concrete|concrete set and fill bollards)$/.test(name);
}
function isExcludedPumpingItem(item: DirectCostItem, sourceName: string) {
  const name = (item.description?.trim() || sourceName).normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()
    // Change-order labels do not change the equipment being excluded.
    .replace(/^co\s*\d+\s*[-\u2013\u2014]\s*/, '');
  return item.costCode?.trim() === '03-300-40-30'
    && !/^(labor|l)$/i.test(item.costType?.trim() || '')
    && EXCLUDED_PUMPING_ITEMS.has(name);
}
export function directCostMonth(month: string) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Choose a valid month (YYYY-MM).');
  const start = new Date(`${month}-01T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

export type DirectCostSource = {
  id: string; date: Date; status: string | null; quantityUsed: number | null;
  lineItemId: string | null; lineItemDescription: string | null;
  lineItemHolderTitle: string | null; lineItemHolderNumber?: string | null;
  lineItemHolderId?: string | null; lineItemHolderType?: string | null; updatedAt: Date;
};
export type DirectCostItem = {
  procoreId: string | null; description: string | null; unitCost: number | null;
  uom: string | null; updatedAt: Date;
  costCode?: string | null; costType?: string | null;
  purchaseOrderContract?: { number: string | null; title: string | null } | null;
  procorePurchaseOrderContractId?: string | null;
  pricingIssue?: string | null;
  catalogPrice?: CatalogPriceEvidence | null;
};
export type DirectCostIssueSource = { message: string; date: string; purchaseOrderId: string | null; catalogLineItemId?: string; target?: 'purchaseOrder' | 'dailyLog' | 'catalog' };
function issueSource(log: DirectCostSource, item?: DirectCostItem) {
  const po = (number?: string | null, title?: string | null) =>
    [number?.trim() ? (/^PO\b/i.test(number.trim()) ? number.trim() : `PO ${number.trim()}`) : '', title?.trim()].filter(Boolean).join(' — ');
  const sourcePo = po(log.lineItemHolderNumber, log.lineItemHolderTitle);
  const costPo = po(item?.purchaseOrderContract?.number, item?.purchaseOrderContract?.title);
  const references = [sourcePo || costPo || 'PO not available'];
  if (sourcePo && costPo && costPo !== sourcePo) references.push(`Cost source: ${costPo}`);
  return `${references.join('; ')}; daily log ${log.date.toISOString().slice(0, 10)}`;
}
export function aggregateDirectCosts(logs: DirectCostSource[], items: DirectCostItem[], aliases: Map<string, string>) {
  const issues: string[] = [];
  const issueSources: DirectCostIssueSource[] = [];
  const addIssue = (message: string, log: DirectCostSource, item?: DirectCostItem) => {
    issues.push(message);
    const poId = item?.procorePurchaseOrderContractId || (/purchase.?order/i.test(log.lineItemHolderType || '') ? log.lineItemHolderId : null);
    issueSources.push({ message, date: log.date.toISOString().slice(0, 10), purchaseOrderId: /^\d+$/.test(poId || '') ? poId! : null, ...(item?.pricingIssue && item.procoreId ? { catalogLineItemId: item.procoreId } : {}), target: item?.pricingIssue ? 'catalog' : item ? 'purchaseOrder' : 'dailyLog' });
  };
  const excluded = { unapproved: 0, billingFile: 0, zeroUsage: 0, concrete: 0, pumpingEquipment: 0, shopDrawings: 0 };
  const seen = new Set<string>();
  const itemMap = new Map<string, DirectCostItem[]>();
  for (const item of items) {
    if (item.procoreId) itemMap.set(item.procoreId, [...(itemMap.get(item.procoreId) || []), item]);
  }
  const groups = new Map<string, { item: DirectCostItem; quantity: Prisma.Decimal; sourceLogs: { id: string; date: string; quantity: string; updatedAt: string }[] }>();
  for (const log of logs) {
    const sourceName = log.lineItemDescription?.trim() || 'Unnamed item';
    const sourceLabel = `${sourceName} (${issueSource(log)})`;
    if (seen.has(log.id)) { addIssue(`${sourceLabel}: duplicate daily-log entry.`, log); continue; }
    seen.add(log.id);
    if (/billing file/i.test(log.lineItemHolderTitle || '')) { excluded.billingFile++; continue; }
    if (log.status?.toLowerCase() !== 'approved') { excluded.unapproved++; continue; }
    if (log.quantityUsed === null || !Number.isFinite(log.quantityUsed)) { addIssue(`${sourceLabel}: no valid quantity used.`, log); continue; }
    if (log.quantityUsed === 0) { excluded.zeroUsage++; continue; }
    if (log.quantityUsed < 0) { addIssue(`${sourceLabel}: negative quantity requires review.`, log); continue; }
    const itemId = aliases.get(log.lineItemId || '') || log.lineItemId;
    const matches = itemMap.get(itemId || '') || [];
    if (matches.length !== 1) { addIssue(`${sourceLabel}: expected one matching Procore cost line; found ${matches.length}.`, log); continue; }
    const item = matches[0];
    // Shop drawing vendor bills are entered separately, including legacy PO
    // charges labeled Labor or carried under a different cost code.
    if (isShopDrawingCost(item.costCode, item.description?.trim() || sourceName)) {
      excluded.shopDrawings++; continue;
    }
    if (isExcludedPumpingItem(item, sourceName)) {
      excluded.pumpingEquipment++; continue;
    }
    if (isExcludedConcrete(item, sourceName)) {
      excluded.concrete++; continue;
    }
    if (item.pricingIssue) { addIssue(`${item.pricingIssue} ${issueSource(log, item)}.`, log, item); continue; }
    const missingCost = item.unitCost === null || !Number.isFinite(item.unitCost) || item.unitCost <= 0;
    const missingUnit = !item.uom?.trim();
    if (missingCost || missingUnit) {
      const name = item.description?.trim() || sourceName;
      const needed = [missingCost ? 'a positive unit cost' : '', missingUnit ? 'a unit of measure' : ''].filter(Boolean).join(' and ');
      addIssue(`${name} needs ${needed}. ${issueSource(log, item)}.`, log, item); continue;
    }
    const group = groups.get(itemId!) || { item, quantity: new Prisma.Decimal(0), sourceLogs: [] };
    group.quantity = group.quantity.plus(String(log.quantityUsed));
    group.sourceLogs.push({ id: log.id, date: log.date.toISOString().slice(0, 10), quantity: String(log.quantityUsed), updatedAt: log.updatedAt.toISOString() });
    groups.set(itemId!, group);
  }
  const lines = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([procoreLineItemId, group]) => ({
    procoreLineItemId,
    description: group.item.description || `Procore item ${procoreLineItemId}`,
    costCode: group.item.costCode || null,
    costType: group.item.costType || null,
    quantity: group.quantity.toString(),
    unitCost: String(group.item.unitCost),
    uom: group.item.uom!,
    amount: group.quantity.mul(String(group.item.unitCost)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
    rateUpdatedAt: group.item.updatedAt.toISOString(),
    ...(group.item.catalogPrice ? { catalogPrice: group.item.catalogPrice } : {}),
    sourceLogs: group.sourceLogs.sort((a, b) => a.id.localeCompare(b.id)),
  }));
  return { lines, issues, issueSources, excluded, total: lines.reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0)).toFixed(2) };
}


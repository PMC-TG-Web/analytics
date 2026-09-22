import { Prisma } from '@prisma/client';

export type CatalogPrice = {
  itemId: string; catalogId: string; name: string; costCode: string;
  type: string; uom: string; unitCost: string | null; laborRate: string | null; description?: string;
};
export type CatalogPriceEvidence = { itemId: string; catalogId: string; name: string; unitCost: string; uom: string };
export type BillCatalogSnapshot = { version: 1; companyId: string; fetchedAt: string; items: CatalogPrice[] };
export const BILL_CATALOG_DATASET = 'qbo_cost_catalog';
export const BILL_CATALOG_PROJECT = '__company__';
export const BILL_CATALOG_MAX_AGE_MS = 24 * 60 * 60_000;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function catalogName(value: string) {
  let name = value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
    .replace(/^co\s*\d+\s*[-\u2013\u2014]\s*/, '')
    .replace(/\s+-\s+(sog|foundation|foundations|wall|site)$/, '');
  // Rebar spacing describes installation, not the bar size or purchased length.
  // Only remove a terminal, explicitly labelled on-center spacing annotation.
  if (/^#\d+\s+rebar\b/.test(name)) name = name.replace(/\s+[-\u2013\u2014]\s+\d+(?:\.\d+)?\s*["\u2033]\s*o\.?\s*c\.?(?:\s*e\.?\s*w\.?)?$/, '');
  return name.replace(/\s+-\s+/g, ' ').replace(/\s+/g, '');
}
export function catalogUnit(value: string) {
  const unit = value.trim().toLowerCase().replace(/[.\s_]/g, '');
  if (['ea', 'each', 'pc', 'pcs', 'piece', 'pieces'].includes(unit)) return 'ea';
  if (['hr', 'hrs', 'hour', 'hours'].includes(unit)) return 'hr';
  if (['lf', 'ft', 'linearfeet', 'linearfoot', 'linealfeet'].includes(unit)) return 'lf';
  if (['sf', 'sqft', 'squarefeet', 'squarefoot'].includes(unit)) return 'sf';
  if (['cy', 'cuyd', 'cubicyards', 'cubicyard'].includes(unit)) return 'cy';
  return unit;
}
function price(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  try { const n = new Prisma.Decimal(String(value)); return n.isFinite() && n.gt(0) ? n.toDecimalPlaces(8).toString() : null; }
  catch { return null; }
}
export function normalizeCatalogPrice(value: unknown, crosswalkCode?: string): CatalogPrice | null {
  const row = record(value), code = record(row.cost_code);
  const costCode = String(code.full_code || code.code || row.cost_code || crosswalkCode || '').trim().replace(/\.[A-Z]+$/i, '');
  if (!/^\d+$/.test(String(row.id || '')) || !/^\d{2}-\d{3}-\d{2}-\d{2}$/.test(costCode) || row.deleted_at || row.active === false) return null;
  return { itemId: String(row.id), catalogId: String(row.catalog_id || ''), name: String(row.name || '').trim(), costCode,
    type: String(row.type || '').toUpperCase(), uom: catalogUnit(String(row.unit || '')), description: String(row.description || '').trim(),
    unitCost: price(row.unit_cost), laborRate: price(row.unit_labor_cost) };
}
export function catalogSnapshotIssue(snapshot: BillCatalogSnapshot | null, companyId: string, now = Date.now()) {
  if (!snapshot || snapshot.version !== 1 || snapshot.companyId !== companyId || !snapshot.items.length) return 'Current Cost Catalog prices are unavailable. Keep this page open to synchronize the catalog.';
  const age = now - Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(age) || age < -60_000 || age > BILL_CATALOG_MAX_AGE_MS) return 'Cost Catalog prices need a refresh before this bill can be saved. Keep this page open to synchronize the catalog.';
  return null;
}
export function matchCatalogPrice(item: { description: string | null; costCode?: string | null; uom: string | null; catalogItemId?: string | null; costType?: string | null }, prices: CatalogPrice[], aliases: Map<string, { itemName: string; costCode: string }>) {
  const name = item.description || 'Unnamed item';
  const code = (item.costCode || '').trim().replace(/\.[A-Z]+$/i, '');
  const labor = /^(labor|l)$/i.test(item.costType || '');
  let matches = prices.filter(p => labor === (p.type === 'LABOR'));
  if (item.catalogItemId) matches = matches.filter(p => p.itemId === item.catalogItemId);
  else matches = matches.filter(p => p.costCode === code && (catalogName(p.name) === catalogName(name)
    || (!!p.description?.trim() && catalogName(p.description) === catalogName(name))
    || (aliases.get(p.itemId)?.costCode === code && catalogName(aliases.get(p.itemId)!.itemName) === catalogName(name))));
  const fail = (reason: string) => ({ unitCost: null, evidence: null, issue: `${name}: ${reason}` });
  if (matches.length !== 1) return fail(matches.length ? 'multiple Cost Catalog items match; a unique catalog item is required.' : 'no matching current Cost Catalog item. Check the catalog item name and cost code.');
  const found = matches[0];
  if (found.costCode !== code) return fail('the linked Cost Catalog item has a different cost code.');
  if (!item.uom || !found.uom || catalogUnit(item.uom) !== found.uom) return fail(`Cost Catalog unit (${found.uom || 'missing'}) does not match daily-log/PO unit (${item.uom || 'missing'}).`);
  const unitCost = labor ? found.laborRate : found.unitCost;
  if (!unitCost) return fail('the Cost Catalog item needs a positive current unit cost.');
  const evidence: CatalogPriceEvidence = { itemId: found.itemId, catalogId: found.catalogId, name: found.name, unitCost, uom: found.uom };
  return { unitCost: Number(unitCost), evidence, issue: null };
}

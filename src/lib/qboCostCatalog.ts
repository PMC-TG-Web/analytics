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
  // Sonotube is the field name for catalog Standard Wall Construction tubes.
  const tube = name.match(/^(\d+(?:\.\d+)?)\s*["\u2033]\s*[x\u00d7]\s*(\d+(?:\.\d+)?)\s*['\u2032]\s*sonotubes?$/);
  if (tube) name = `standard wall construction ${tube[1]}" x ${tube[2]}'`;
  // Full shorthand bar size + purchased length, never a partial/fuzzy match.
  name = name.replace(/^#(\d+)\s*[x\u00d7]\s*(\d+(?:\.\d+)?)\s*['\u2032]\s*rebar$/, "#$1 rebar - $2' pc");
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
function catalogMatchName(value: string) {
  // Normalize known material nouns only. Keep sizes, lengths, coatings, and
  // qualifiers (such as base/tube) intact. Do not change saved source signatures.
  return catalogName(value.normalize('NFKC').toLowerCase()
    .replace(/\s*[-\u2013\u2014]\s*(sog|site|wall|walls|foundation|foundations|slab on grade|slab on deck)\s*$/, '')
    .replace(/\b(dowels|chairs|tubes|sheets|rolls|bars|bags|anchors|caps|pieces|bollards)\b/g, word => word.slice(0, -1)));
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
  else matches = matches.filter(p => p.costCode === code && (catalogMatchName(p.name) === catalogMatchName(name)
    || (!!p.description?.trim() && catalogMatchName(p.description) === catalogMatchName(name))
    || (aliases.get(p.itemId)?.costCode === code && catalogMatchName(aliases.get(p.itemId)!.itemName) === catalogMatchName(name))));
  const fail = (reason: string) => ({ unitCost: null, evidence: null, issue: `${name}: ${reason}` });
  let matchedAcrossCodes = false;
  if (!matches.length && !item.catalogItemId) {
    const otherCodes = prices.filter(p => p.costCode !== code && labor === (p.type === 'LABOR')
      && (catalogMatchName(p.name) === catalogMatchName(name) || (!!p.description?.trim() && catalogMatchName(p.description) === catalogMatchName(name))));
    if (otherCodes.length) {
      const rates = otherCodes.map(p => labor ? p.laborRate : p.unitCost);
      if (rates.some(rate => !rate || !Number.isFinite(Number(rate)) || Number(rate) <= 0)) return fail('matching catalog items under other cost codes include missing prices. Confirm the pricing source.');
      if (new Set(rates.map(Number)).size > 1) return fail('matching catalog items under other cost codes have different prices. Confirm the pricing source.');
      matches = [[...otherCodes].sort((a, b) => a.itemId.localeCompare(b.itemId))[0]];
      matchedAcrossCodes = true;
    }
  }
  if (matches.length !== 1) return fail(matches.length ? 'multiple Cost Catalog items match; a unique catalog item is required.' : 'no matching current Cost Catalog item. Check the catalog item name and cost code.');
  const found = matches[0];
  if (!matchedAcrossCodes && found.costCode !== code) return fail('the linked Cost Catalog item has a different cost code.');

  const unitCost = labor ? found.laborRate : found.unitCost;
  if (!unitCost) return fail('the Cost Catalog item needs a positive current unit cost.');
  const evidence: CatalogPriceEvidence = { itemId: found.itemId, catalogId: found.catalogId, name: found.name, unitCost, uom: found.uom };
  return { unitCost: Number(unitCost), evidence, issue: null };
}

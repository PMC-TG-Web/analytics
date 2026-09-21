import { createHash } from 'node:crypto';
import { catalogName, catalogUnit, matchCatalogPrice, type CatalogPrice } from './qboCostCatalog';

export type CatalogMappingSource = { description: string | null; costCode?: string | null; costType?: string | null; uom: string | null; catalogItemId?: string | null };
export type SavedCatalogMapping = { catalogItemId: string | null; sourceSignature: string; revision: number };
export function catalogSourceSignature(source: CatalogMappingSource) {
  return createHash('sha256').update(JSON.stringify([catalogName(source.description || ''), source.costCode?.trim() || '', source.costType?.trim().toLowerCase() || '', catalogUnit(source.uom || '')])).digest('hex');
}
export function catalogMappingCandidates(source: CatalogMappingSource, items: CatalogPrice[]) {
  const labor = /^(labor|l)$/i.test(source.costType || '');
  return items.filter(item => (item.type === 'LABOR') === labor && !!item.uom && item.uom === catalogUnit(source.uom || '') && Number(labor ? item.laborRate : item.unitCost) > 0)
    .map(item => ({ itemId: item.itemId, name: item.name, description: item.description || '', costCode: item.costCode, uom: item.uom, unitCost: (labor ? item.laborRate : item.unitCost)!, sameCostCode: item.costCode === source.costCode }))
    .sort((a, b) => Number(b.sameCostCode) - Number(a.sameCostCode) || a.name.localeCompare(b.name) || a.itemId.localeCompare(b.itemId));
}
export function mappedCatalogPrice(source: CatalogMappingSource, items: CatalogPrice[], aliases: Map<string, { itemName: string; costCode: string }>, mapping?: SavedCatalogMapping) {
  if (!mapping?.catalogItemId) return matchCatalogPrice(source, items, aliases);
  const fail = (issue: string) => ({ unitCost: null, evidence: null, issue: `${source.description || 'Item'}: ${issue}` });
  if (mapping.sourceSignature !== catalogSourceSignature(source)) return fail('the source item changed since its catalog mapping was saved. Review the mapping again.');
  const selected = catalogMappingCandidates(source, items).find(item => item.itemId === mapping.catalogItemId);
  if (!selected) return fail('the saved Cost Catalog item is unavailable or no longer has a compatible unit and positive price. Review its mapping.');
  // Explicit operator choice may cross a legacy PO budget code. Keep the original
  // source/QBO product code; only the current price comes from the selected item.
  return matchCatalogPrice({ ...source, catalogItemId: selected.itemId, costCode: selected.costCode }, items, aliases);
}

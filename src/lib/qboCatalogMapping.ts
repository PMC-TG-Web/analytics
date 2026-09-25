import { createHash } from 'node:crypto';
import { catalogName, catalogUnit, matchCatalogPrice, type CatalogPrice } from './qboCostCatalog';

export type CatalogMappingSource = { description: string | null; costCode?: string | null; costType?: string | null; uom: string | null; catalogItemId?: string | null };
export type SavedCatalogMapping = { catalogItemId: string | null; sourceSignature: string; revision: number };
export function catalogSourceSignature(source: CatalogMappingSource) {
  return createHash('sha256').update(JSON.stringify([catalogName(source.description || ''), source.costCode?.trim() || '', source.costType?.trim().toLowerCase() || '', catalogUnit(source.uom || '')])).digest('hex');
}
export function catalogMappingCandidates(source: CatalogMappingSource, items: CatalogPrice[]) {
  const labor = /^(labor|l)$/i.test(source.costType || '');
  return items.filter(item => (item.type === 'LABOR') === labor && Number(labor ? item.laborRate : item.unitCost) > 0)
    .map(item => ({ itemId: item.itemId, name: item.name, description: item.description || '', costCode: item.costCode, uom: item.uom, unitCost: (labor ? item.laborRate : item.unitCost)!, sameCostCode: item.costCode === source.costCode }))
    .sort((a, b) => Number(b.sameCostCode) - Number(a.sameCostCode) || a.name.localeCompare(b.name) || a.itemId.localeCompare(b.itemId));
}
export function duplicateCatalogSourceIds(sources: (CatalogMappingSource & { procoreId: string | null })[]) {
  const groups = new Map<string, Set<string>>();
  for (const source of sources) {
    if (!source.procoreId) continue;
    const key = JSON.stringify([(source.costCode || '').trim().replace(/\.[A-Z]+$/i, ''), (source.description || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')]);
    const ids = groups.get(key) || new Set<string>(); ids.add(source.procoreId); groups.set(key, ids);
  }
  return new Set([...groups.values()].filter(ids => ids.size > 1).flatMap(ids => [...ids]));
}
export function mappedCatalogPrice(source: CatalogMappingSource, items: CatalogPrice[], aliases: Map<string, { itemName: string; costCode: string }>, mapping?: SavedCatalogMapping, allowCodeFallback = false) {
  if (!mapping?.catalogItemId) {
    const exact = matchCatalogPrice(source, items, aliases);
    // Explicit identities and named matches retain their existing validation.
    if (!allowCodeFallback || source.catalogItemId || !exact.issue?.includes('no matching current Cost Catalog item')) return exact;
    const code = (source.costCode || '').trim().replace(/\.[A-Z]+$/i, '');
    const labor = /^(labor|l)$/i.test(source.costType || '');
    const candidates = items.filter(item => item.costCode === code && (item.type === 'LABOR') === labor);
    if (!candidates.length) return exact;
    const rates = candidates.map(item => labor ? item.laborRate : item.unitCost);
    if (rates.some(rate => !rate || !Number.isFinite(Number(rate)) || Number(rate) <= 0)) return { unitCost: null, evidence: null, issue: `${source.description || 'Item'}: no exact catalog match was found. Other items sharing this cost code include missing prices, so a price cannot be selected automatically. Confirm the catalog item used to price this line.` };
    if (new Set(rates.map(Number)).size !== 1) return { unitCost: null, evidence: null, issue: `${source.description || 'Item'}: no exact catalog match was found, and items sharing this cost code have different current prices. Confirm the catalog item used to price this line.` };
    // Equal rates require no pricing decision; use a stable item as evidence.
    const selected = [...candidates].sort((a, b) => a.itemId.localeCompare(b.itemId))[0];
    return matchCatalogPrice({ ...source, catalogItemId: selected.itemId }, items, aliases);
  }
  const fail = (issue: string) => ({ unitCost: null, evidence: null, issue: `${source.description || 'Item'}: ${issue}` });
  if (mapping.sourceSignature !== catalogSourceSignature(source)) return fail('the source item changed since its catalog mapping was saved. Review the mapping again.');
  const selected = catalogMappingCandidates(source, items).find(item => item.itemId === mapping.catalogItemId);
  if (!selected) return fail('the saved Cost Catalog item is unavailable or no longer has a positive price. Review its mapping.');
  // Explicit operator choice may cross a legacy PO budget code. Keep the original
  // source/QBO product code; only the current price comes from the selected item.
  return matchCatalogPrice({ ...source, catalogItemId: selected.itemId, costCode: selected.costCode }, items, aliases);
}

export type PurchasePriceEvidence = { companyId: string; projectId: string; lineKey: string; costCode: string; uom: string; unitCost: string; catalogCodeItemId: string; catalogId: string };
export function purchasePriceFallback(source: CatalogMappingSource & { procoreId: string | null; unitCost: number | null }, items: CatalogPrice[], aliases: Map<string, { itemName: string; costCode: string }>, mapping: SavedCatalogMapping | undefined, companyId: string, projectId: string) {
 if (mapping?.catalogItemId || source.catalogItemId || !source.procoreId || !source.uom) return null;
 const exact=matchCatalogPrice(source,items,aliases);
 if (!exact.issue?.includes('no matching current Cost Catalog item')) return null;
 const code=(source.costCode || '').trim().replace(/\.[A-Z]+$/i,'');
 const found=items.filter(i=>i.costCode===code).sort((a,b)=>a.itemId.localeCompare(b.itemId))[0];
 if (!found) return null;
 const rate=String(source.unitCost ?? '');
 if (!/^\d{1,10}(\.\d{1,8})?$/.test(rate) || Number(rate)<=0) return null;
 return {unitCost:Number(rate),evidence:{companyId,projectId,lineKey:source.procoreId,costCode:code,uom:source.uom,unitCost:rate,catalogCodeItemId:found.itemId,catalogId:found.catalogId} satisfies PurchasePriceEvidence};
}

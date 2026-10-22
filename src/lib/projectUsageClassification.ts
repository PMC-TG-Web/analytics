import { isVendorPumpingOrTrailer } from './qboDirectCostExclusions.js';
import { projectManagementPrice } from './qboProjectManagementRate.js';
import { classifyProductivityCompletionLine } from './productivityWeightedCompletion.ts';

type Item = { description: string | null; costType: string | null; costCode: string | null; uom: string | null; quantity: number | null };
type Classification = { kind: 'labor' | 'materials' | 'other'; unit: string; note: string };

/** Report-only exceptions for uniquely matched PO items; no source code or billing changes.
 * Legacy POs assign a single labor budget code to concrete, products and equipment.
 * Descriptions establish item kind only with compatible units; quantities never become
 * hours simply because their PO cost type is Labor.
 */
export function classifyProjectUsageItem(item: Item): Classification | null {
  const name = (item.description || '').normalize('NFKC').trim().replace(/\s+/g, ' ')
    .replace(/^co\s*\d+\s*[-–—]\s*/i, '')
    .replace(/\s*[-–—]\s*(sog|site|wall|walls|foundation|foundations)\s*$/i, '').trim();
  const unit = (item.uom || '').trim().toUpperCase();
  const labor = /^(l|labor|labour)$/i.test(item.costType?.trim() || '');
  // These describe equipment/service quantities even when the rental includes an operator.
  if (isVendorPumpingOrTrailer(name) || /^(?:telehandler\b|auto\s*scrubber rental$)/i.test(name)) {
    return { kind: 'other', unit, note: `Equipment/service quantity; retained in its recorded unit, not labor hours or concrete CY. Saved cost type: ${item.costType || 'missing'}.` };
  }
  // Some concrete PO lines carry Other or the dedicated Concrete cost type.
  // Require the concrete material code, explicit CY unit and material description
  // together. A cost-type label alone must not discard recorded placed concrete.
  const concreteMaterialCode = /^(?:03-300-(?:00|10|20|30)-20|05-100-10-20)$/.test(item.costCode?.trim() || '');
  const cubicYards = /^(cy|cu\.?\s*yd|cubic\s*yards?)$/i.test(unit);
  const concrete = /^(?:ready[ -]?mix concrete\b|(?:slab on grade|foundation|wall|site|bollards) concrete\b|concrete set and fill bollards\b|(?:non[ -]?taxable\s+)?sog concrete\b|concrete$)/i.test(name)
    && !/\b(?:labor|placing|placement|finishing|cutting|sealer|curing|equipment|rental|fiber|fibre|washout|testing)\b/i.test(name);
  if (/^(?:o|other|con|concrete)$/i.test(item.costType?.trim() || '') && concreteMaterialCode && cubicYards && concrete
    && classifyProductivityCompletionLine(item) === 'concrete') {
    return { kind: 'materials', unit: 'CY', note: `Concrete material identified by material code, description and cubic-yard unit. Saved cost type: ${item.costType}; original cost code retained.` };
  }
  if (!labor) return null;
  if (/^(ea|each)$/i.test(unit) && projectManagementPrice(item)) {
    return { kind: 'labor', unit: 'HR', note: 'Legacy Project Management EA quantities are hours under the existing project-management policy. Original unit: EA.' };
  }
  if (cubicYards && concrete) return { kind: 'materials', unit: 'CY', note: 'Concrete material identified by item description and cubic-yard unit. Saved cost type: Labor; original cost code retained.' };
  // Explicit product names from saved PO descriptions and the material catalog.
  // Do not use a broad "concrete" or "seal" substring to reinterpret labor/services.
  const product = /^(?:l&m curing compound(?: \d+(?:\.\d+)? gal\.?)?|tk-floor hardner and densifier 55 gal|aussie built (?:earth binder|stabilised earth) sealer|tk cure n seal|v-seal 102 5 gal)$/i.test(name);
  if (/^(ea|each|pc|pcs|piece|pieces)$/i.test(unit) && product) return { kind: 'materials', unit, note: 'Sealer/curing product identified by its item description and piece unit. Saved cost type: Labor; original quantity and cost code retained.' };
  if (item.quantity === 0 && !/^(h|hr|hrs|hour|hours|ls)$/i.test(unit)) return { kind: 'other', unit, note: `Zero recorded quantity in ${unit || 'an unknown unit'}; no labor hours inferred.` };
  return null;
}

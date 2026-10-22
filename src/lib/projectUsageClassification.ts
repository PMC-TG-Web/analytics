import { isVendorPumpingOrTrailer } from './qboDirectCostExclusions.js';
import { projectManagementPrice } from './qboProjectManagementRate.js';
import { classifyProductivityCompletionLine } from './productivityWeightedCompletion.ts';

type Item = { description: string | null; costType: string | null; costCode: string | null; uom: string | null; quantity: number | null };
type Classification = { kind: 'labor' | 'materials' | 'other' | 'review'; unit: string; note: string };

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
  if (isVendorPumpingOrTrailer(name) || /\b(?:rental|telehandler|somero|laser screed|skidloader|dump truck|line dragon|golf cart)\b/i.test(name)) {
    return { kind: 'other', unit, note: `Equipment/service quantity; retained in its recorded unit, not labor hours or concrete CY. Saved cost type: ${item.costType || 'missing'}.` };
  }
  if (/^(?:food|breakfast|lunch|dinner|mobilization|light load\b)/i.test(name)) {
    return { kind: 'other', unit, note: 'Expense/service quantity; not installed material or labor hours.' };
  }
  // Some concrete PO lines carry Other or the dedicated Concrete cost type.
  // Require the concrete material code, compatible unit and material description
  // together. A cost-type label alone must not discard recorded placed concrete.
  const concreteMaterialCode = /^(?:03-300-(?:00|10|20|30)-20|05-100-10-20)$/.test(item.costCode?.trim() || '');
  const cubicYards = /^(cy|cu\.?\s*yd|cubic\s*yards?)$/i.test(unit);
  const concrete = /^(?:\d+\s*psi\s+)?(?:ready[ -]?mix concrete\b|(?:slab on grade|foundation|wall|site|bollards) concrete\b|concrete set and fill bollards\b|(?:non[ -]?taxable\s+)?sog concrete\b|concrete$)/i.test(name)
    && !/\b(?:labor|placing|placement|finishing|cutting|sealer|curing|equipment|rental|fiber|fibre|washout|testing)\b/i.test(name);
  if (/^(?:o|other|con|concrete)$/i.test(item.costType?.trim() || '') && concreteMaterialCode && (cubicYards || /^(ea|each)$/i.test(unit)) && concrete
    && classifyProductivityCompletionLine(item) === 'concrete') {
    return { kind: 'materials', unit: 'CY', note: `Concrete material identified by material code and description. Original unit: ${unit}; existing concrete CY correction applies. Saved cost type: ${item.costType}; original cost code retained.` };
  }
  const other = /^(?:o|other)$/i.test(item.costType?.trim() || '');
  const code = item.costCode?.trim() || '';
  if (other && /^(?:01-300-10-30|03-300-(?:00|10|20|30)-10)$/.test(code)
    && /\blabor\b/i.test(name) && /^(h|hr|hrs|hour|hours)$/i.test(unit)) {
    return { kind: 'labor', unit: 'HR', note: 'Labor identified by labor cost code, description and explicit hour unit. Saved cost type: Other.' };
  }
  // Material codes alone are insufficient: equipment and food also occur on these codes.
  const materialCode = /^(?:03-150-10-(?:05|35|45|85)|03-100-(?:10|20|30)-20|03-200-(?:10|20|30|40)-20|03-200-50-(?:20|30)|03-300-40-(?:40|60)|05-100-10-10|31-100-10-30)$/.test(code);
  const materialName = /\b(?:rebar|wire|mesh|chairs?|dowels?|expansion|foam|greenguard|vapor barrier|viper tape|forms?|waterstop|hydrostrip|expand-tite|sika swell|sealer|curing|cure|kure|dress seal|v-seal|densifier|ada plate|bollards?|stone|sonotubes?|color|adhesive|epoxy|chamfer|planitop)\b/i.test(name)
    || /^materials$/i.test(name)
    || (/^03-200-(?:10|20|30|40)-20$/.test(code) && /^#[3-8]\s+non[ -]taxable,?\s+\d+(?:\.\d+)?['’′]\s+pc$/i.test(name));
  const pieceOrMeasured = /^(ea|each|pc|pcs|piece|pieces|sf|sq\.?\s*ft|lf|ft|lb|lbs|ton|tons|us tons?|short tons?|gal|gallons?)$/i.test(unit);
  const serviceDescription = /\b(?:labor|labour|installation|installing|service|testing|rental)\b/i.test(name);
  if (other && !serviceDescription && pieceOrMeasured && ((materialCode && materialName)
    || (/^03-200-30-10$/.test(code) && /^#[3-8]\s+rebar\b/i.test(name)))) {
    return { kind: 'materials', unit, note: 'Material identified by cost code, item description and quantity unit. Saved cost type: Other; original quantity and unit retained.' };
  }
  if (other && !serviceDescription && concreteMaterialCode && /^(ea|each|cy|ls)$/i.test(unit) && /\bfib(?:er|re)\b/i.test(name)) {
    return { kind: 'materials', unit: 'EA', note: `Fiber material; existing fiber EA correction applies. Original unit: ${unit}; Saved cost type: Other. Not concrete CY.` };
  }
  if (/^(?:o|other|con|concrete|m|materials?)$/i.test(item.costType?.trim() || '') && concreteMaterialCode && /^bollards?$/i.test(name) && /^(ea|each)$/i.test(unit)) {
    return { kind: 'materials', unit, note: 'Bollards counted as pieces; description does not establish concrete CY.' };
  }
  if (other && materialCode) return { kind: 'review', unit, note: 'Material cost code with Other cost type; item description or unit needs confirmation.' };
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

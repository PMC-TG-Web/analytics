import { rebarWeightPerFoot } from './rebarSpecifications.ts';

/** Only explicit bar shorthand on a rebar material code supplies the missing noun. */
export function rebarUsageDescription(description: string, costCode?: string | null) {
  if (/^03-200-(?:10|20|30|40)-20$/.test(costCode?.trim() || '')) {
    return description.replace(/(^|\/\s*)(#[3-8])\s+(non[ -]taxable,?\s+\d+(?:\.\d+)?['’′]\s+pc\b)/gi, '$1$2 Rebar $3');
  }
  return description;
}

export function isRebarUsage(description: string) {
  return /\b(?:rebar|reinforcing bars?|reinforcement bars?)\b/i.test(description)
    && !/\b(?:chairs?|dowels?|wire|meshes?|wwf|spacers?|sleeves?|fabrication|epoxy|adhesive|anchors?)\b/i.test(description);
}

/** US short tons. Missing/conflicting dimensions never imply a standard stick length. */
export function calculateRebarUsageTons(quantity: number, unit: string, descriptions: (string | null | undefined)[]) {
  const description = descriptions.filter(Boolean).join(' / ');
  if (!Number.isFinite(quantity) || !isRebarUsage(description)) return null;
  if (/^(lb|lbs|pound|pounds)$/i.test(unit.trim())) return quantity / 2000;
  if (/^(us tons?|short tons?)$/i.test(unit.trim())) return quantity;
  const sizes = new Set([...description.matchAll(/#\s*([3-8])\s*(?:[-–]\s*)?(?:(?:non[\s-]*taxable\s+)?(?:rebar|bar)\b|x\s*\d)|\b(?:rebar|bar)\s*#\s*([3-8])(?!\d)/gi)].map(m => m[1] || m[2]));
  if (sizes.size !== 1) return null;
  const weight = rebarWeightPerFoot[`#${[...sizes][0]}`];
  if (/^(lf|ft|feet|foot|linear feet)$/i.test(unit.trim())) return quantity * weight / 2000;
  if (!/^(ea|each|pc|pcs|piece|pieces)$/i.test(unit.trim())) return null;
  const lengths = new Set([...description.matchAll(/(?:\b|x)(\d+(?:\.\d+)?)\s*(?:'|’|′|ft\.?\b|feet\b|foot\b)/gi)].map(m => Number(m[1])));
  if (lengths.size !== 1) return null;
  const length = [...lengths][0];
  // Mixed feet/inches and fractional dimensions need an explicit decimal-foot value.
  if (length <= 0 || /\d+\s*\/\s*\d+\s*(?:'|’|′|ft)|(?:'|’|′|ft)\s*[- ]*\d+\s*(?:"|”|″|in\b)/i.test(description)) return null;
  return quantity * length * weight / 2000;
}

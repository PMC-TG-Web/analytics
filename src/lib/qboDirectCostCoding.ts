// Bill-only coding overrides. Procore source records remain unchanged.
export function isFoodCost(source: { description: string | null; costCode?: string | null; costType?: string | null }) {
  const name = (source.description || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ').replace(/^co\s*\d+\s*[-\u2013\u2014]\s*/, '');
  const foodCode = (source.costCode || '').trim().replace(/\.[A-Z]+$/i, '') === '01-300-10-80';
  return (foodCode || /^(food|food cost|breakfast|lunch|dinner|meals?)$/.test(name)) && !/^(labor|l)$/i.test(source.costType?.trim() || '');
}
function normalizedEquipmentName(description: string | null) {
  return (description || '').normalize('NFKC').trim().toLowerCase()
    .replace(/^co\s*\d+\s*[-\u2013\u2014]\s*/, '').replace(/\s+/g, ' ')
    .replace(/\s*[-\u2013\u2014]\s*(sog|site|wall|walls|foundation|foundations|slab on grade|slab on deck)$/, '');
}

export function isManagedScreed(description: string | null) {
  return /^(?:somero[ -]+)?(?:power[ -]*rake|s[ -]*(?:15r?|840|940)|srs[ -]*4?)(?: \(boom screed\))?(?: \(\d+(?:\.\d+)? hr minimum\))?$/.test(normalizedEquipmentName(description));
}

function isLaserScreedingType(costType: string | null | undefined) {
  return /^(?:ls|labor laser screeding)$/i.test(costType?.trim() || '');
}

export function applyDirectCostCoding<T extends { description: string | null; costCode?: string | null; costType?: string | null; wbsCode?: string | null; uom?: string | null }>(source: T): T & { sourceCostType?: string; sourceWbsCode?: string; directCostCodingIssue?: string } {
  if (isManagedScreed(source.description)) {
    const sourceCostType = source.costType?.trim() || '';
    const sourceWbsCode = source.wbsCode?.trim() || '';
    if (!isLaserScreedingType(sourceCostType) || !/\.LS$/i.test(sourceWbsCode)) {
      return { ...source, directCostCodingIssue: `${source.description || 'Screed'} must use the Labor Laser Screeding (.LS) budget code in Procore; current assignment is ${sourceWbsCode || sourceCostType || 'missing'}. Update the PO line and refresh this review.` };
    }
    // QBO keeps its established equipment product and Screeding subclass while
    // the source evidence proves Procore supplied the dedicated .LS assignment.
    return { ...source, costType: 'Equipment', sourceCostType, sourceWbsCode };
  }
  if (!isFoodCost(source)) return source;
  // Materials selects the established .M product suffix and Direct Costs - offset.
  return { ...source, costCode: '01-300-10-80', costType: 'Materials' };
}

// Bill-only coding overrides. Procore source records remain unchanged.
export function isFoodCost(source: { description: string | null; costType?: string | null }) {
  const name = (source.description || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ').replace(/^co\s*\d+\s*[-\u2013\u2014]\s*/, '');
  return /^(food|food cost)$/.test(name) && !/^(labor|l)$/i.test(source.costType?.trim() || '');
}
export function applyDirectCostCoding<T extends { description: string | null; costCode?: string | null; costType?: string | null; uom?: string | null }>(source: T): T {
  const equipmentName = (source.description || '').normalize('NFKC').trim().toLowerCase()
    .replace(/^co\s*\d+\s*[-\u2013\u2014]\s*/, '').replace(/\s+/g, ' ')
    .replace(/\s*[-\u2013\u2014]\s*(sog|site|wall|walls|foundation|foundations|slab on grade|slab on deck)$/, '');
  // Approved equipment charges use Direct Costs -, even when a legacy PO calls
  // them Labor. Hourly labor and other equipment identities are not reclassified.
  if (/^(ea|each)$/i.test(source.uom?.trim() || '')
    && /^somero (power rake|s-840) \(8 hr minimum\)$/.test(equipmentName)) return { ...source, costType: 'Materials' };
  if (!isFoodCost(source)) return source;
  // Materials selects the established .M product suffix and Direct Costs - offset.
  return { ...source, costCode: '01-300-10-80', costType: 'Materials' };
}

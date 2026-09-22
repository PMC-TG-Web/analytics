// Bill-only coding overrides. Procore source records remain unchanged.
export function applyDirectCostCoding<T extends { description: string | null; costCode?: string | null; costType?: string | null }>(source: T): T {
  const name = (source.description || '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ').replace(/^co\s*\d+\s*[-\u2013\u2014]\s*/, '');
  if (!/^(food|food cost)$/.test(name) || /^(labor|l)$/i.test(source.costType?.trim() || '')) return source;
  // Materials selects the established .M product suffix and Direct Costs - offset.
  return { ...source, costCode: '01-300-10-80', costType: 'Materials' };
}

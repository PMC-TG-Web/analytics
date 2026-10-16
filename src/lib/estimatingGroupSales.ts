import { classifyLaborGroup, numericValue, type EstimateAmountLine } from './estimatingDashboardLogic.ts';

type GroupLine = EstimateAmountLine & { groupId?: string | null; groupName?: string | null };
const productionGroups = new Set(['Slab On Grade Labor', 'Site Concrete Labor', 'Wall Labor', 'Foundation Labor']);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function namedGroup(name: string): string | null {
  const matches = [
    [/\b(sog|slab\s+on\s+grade)\b/i, 'Slab On Grade Labor'],
    [/\b(site|sidewalks?|curbs?|aprons?|bollards?)\b/i, 'Site Concrete Labor'],
    [/\bwalls?\b/i, 'Wall Labor'],
    [/\b(foundations?|footings?|footers?|spread\s*footings?|piers?)\b/i, 'Foundation Labor'],
  ] as const;
  const groups = matches.filter(([pattern]) => pattern.test(name)).map(([, group]) => group);
  return groups.length === 1 ? groups[0] : null;
}

/** Call with lines from ONE company, Bid Board project and selected proposal. */
export function estimateSalesByGroup(lines: GroupLine[]): Record<string, number> {
  const scopes = new Map<string, GroupLine[]>();
  lines.forEach((line, index) => {
    // Missing group IDs never associate otherwise unrelated lines.
    const key = line.groupId ? `group:${line.groupId}` : `line:${index}`;
    const scope = scopes.get(key) ?? [];
    scope.push(line);
    scopes.set(key, scope);
  });
  const totals: Record<string, number> = {};
  for (const scope of scopes.values()) {
    const weights = new Map<string, number>();
    const names = new Set<string>();
    let sales = 0;
    for (const line of scope) {
      sales += numericValue(line.itemSales) + numericValue(line.laborSales);
      const hours = numericValue(line.laborHours);
      const laborGroup = classifyLaborGroup(line);
      if (hours > 0 && laborGroup !== 'Other Labor') weights.set(laborGroup, (weights.get(laborGroup) ?? 0) + hours);
      const payload = record(line.payload);
      const group = record(payload.group);
      const name = String(line.groupName || payload.group_name || payload.group_title || group.name || group.title || '');
      const category = namedGroup(name);
      if (category) names.add(category);
    }
    const production = [...weights].filter(([group]) => productionGroups.has(group));
    const candidates = production.length ? production : [...weights];
    if (sales === 0) continue;
    if (candidates.length) {
      candidates.sort((a, b) => a[0].localeCompare(b[0]));
      const totalHours = candidates.reduce((sum, [, hours]) => sum + hours, 0);
      let allocated = 0;
      candidates.forEach(([category, hours], index) => {
        // Preserve the group's full signed value, including any floating-point remainder.
        const share = index === candidates.length - 1 ? sales - allocated : sales * (hours / totalHours);
        totals[category] = (totals[category] ?? 0) + share;
        allocated += share;
      });
    } else {
      const category = names.size === 1 ? [...names][0] : 'Unassigned sales';
      totals[category] = (totals[category] ?? 0) + sales;
    }
  }
  return totals;
}

/** Header totals can contain alternates/adjustments absent from selected lines. */
export function reconcileEstimateGroupSales(groups: Record<string, number>, sales: number): Record<string, number> {
  const result = { ...groups };
  const difference = sales - Object.values(groups).reduce((sum, value) => sum + value, 0);
  if (Math.abs(difference) >= 0.005) result['Estimate adjustments'] = difference;
  return result;
}

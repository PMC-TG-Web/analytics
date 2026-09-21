import { Prisma } from '@prisma/client';

export type LaborTimecard = { procoreId: string | null; date: Date; hours: number | null; totalHoursWorked: number | null; costCodeFullCode: string | null; costCodeName: string | null; updatedAt: Date };
export type LaborRate = { costCode: string; rate: string | null; lineItemId: string; proposalId?: string; bidBoardId?: string; catalogItemId?: string; catalogId?: string; updatedAt: string };
export function aggregateDirectCostLabor(timecards: LaborTimecard[], rates: LaborRate[]) {
  const issues: string[] = [], seen = new Set<string>();
  const groups = new Map<string, { description: string; hours: Prisma.Decimal; sourceLogs: { id: string; date: string; quantity: string; updatedAt: string }[] }>();
  for (const t of timecards) {
    const hours = t.hours ?? t.totalHoursWorked;
    if (!t.procoreId || seen.has(t.procoreId)) { issues.push('A timecard has a missing or duplicate Procore ID.'); continue; }
    seen.add(t.procoreId);
    if (hours === null || !Number.isFinite(hours) || hours < 0) { issues.push(`Timecard ${t.procoreId} needs valid nonnegative hours.`); continue; }
    if (!hours) continue;
    const code = (t.costCodeFullCode || '').trim().replace(/\.L$/i, '') || '(unassigned)';
    const group = groups.get(code) || { description: t.costCodeName || code, hours: new Prisma.Decimal(0), sourceLogs: [] };
    group.hours = group.hours.plus(String(hours));
    group.sourceLogs.push({ id: t.procoreId, date: t.date.toISOString().slice(0, 10), quantity: String(hours), updatedAt: t.updatedAt.toISOString() });
    groups.set(code, group);
  }
  const rows = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([costCode, group]) => {
    let sources: LaborRate[] = [], rate: string | null = null, rateCostCode: string | null = null;
    let conflicting = false, lowestTravel = false;
    // Category, then SOG, then travel within the supplied company pricing snapshot.
    for (const candidate of [...new Set([costCode, '03-300-20-10', '01-300-10-30'])]) {
      const candidates = rates.filter(r => r.costCode.replace(/\.L$/i, '') === candidate);
      const valid = candidates.filter(r => {
        try { return r.rate !== null && new Prisma.Decimal(r.rate).isFinite() && new Prisma.Decimal(r.rate).gt(0); }
        catch { return false; }
      });
      const unique = new Set(valid.map(r => new Prisma.Decimal(r.rate!).toString()));
      if (candidate === '01-300-10-30' && unique.size > 1 && valid.length === candidates.length) {
        rate = [...unique].sort((a, b) => new Prisma.Decimal(a).comparedTo(b))[0];
        sources = valid.filter(r => new Prisma.Decimal(r.rate!).eq(rate!)).sort((a, b) => a.lineItemId.localeCompare(b.lineItemId));
        rateCostCode = candidate; lowestTravel = true; break;
      }
      if (unique.size > 1) { conflicting = true; break; }
      if (unique.size === 1 && valid.length === candidates.length) {
        sources = candidates; rate = [...unique][0]; rateCostCode = candidate; break;
      }
    }
    if (rate === null) issues.push(`${group.description} (${costCode}): ${group.hours.toString()} hours need ${conflicting ? 'one unambiguous positive hourly rate' : 'a category, SOG, or travel hourly rate'}.`);
    return {
      lineKey: `labor:${costCode}`, sourceType: 'timecard' as const, procoreLineItemId: null,
      description: group.description, costCode, costType: 'Labor', quantity: group.hours.toString(),
      unitCost: rate, uom: 'hr', amount: rate === null ? null : group.hours.mul(rate).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
      rateCostCode,
      rateSelection: rateCostCode === null ? 'unresolved' : lowestTravel ? (rateCostCode === costCode ? 'Lowest travel rate' : 'Travel fallback (lowest rate)') : rateCostCode === costCode ? 'category' : rateCostCode === '03-300-20-10' ? 'SOG fallback' : 'Travel fallback',
      rateUpdatedAt: sources.map(s => s.updatedAt).sort().at(-1) || null,
      rateSources: sources.map(s => ({ ...(s.catalogItemId ? { catalogItemId: s.catalogItemId, catalogId: s.catalogId } : { bidBoardId: s.bidBoardId, proposalId: s.proposalId }), lineItemId: s.lineItemId, costCode: s.costCode, rate: s.rate })),
      sourceLogs: group.sourceLogs.sort((a, b) => a.id.localeCompare(b.id)),
    };
  });
  const sumHours = (priced: boolean | null) => rows.filter(r => priced === null || (r.unitCost !== null) === priced).reduce((n, r) => n.plus(r.quantity), new Prisma.Decimal(0)).toString();
  return { rows, issues, totalHours: sumHours(null), pricedHours: sumHours(true), unpricedHours: sumHours(false), total: rows.reduce((n, r) => n.plus(r.amount || 0), new Prisma.Decimal(0)).toFixed(2), lines: rows.filter(r => r.unitCost !== null) };
}

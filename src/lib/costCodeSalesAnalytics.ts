export type CostCodeSalesLine = {
  periodDate: string | Date | null;
  costCode: string | null;
  costCodeName?: string | null;
  reportingGroup?: string | null;
  topLevelGroup?: string | null;
  itemSales?: unknown;
  laborSales?: unknown;
  itemCost?: unknown;
  laborCost?: unknown;
  projectId?: string | null;
};

export type CostCodeMonthlyMetric = {
  period: string;
  year: number;
  month: number;
  costCode: string;
  costCodeName: string | null;
  reportingGroup: string;
  topLevelGroup: string;
  sales: number;
  cost: number;
  profit: number;
  marginPercent: number | null;
  projectCount: number;
  lineCount: number;
};

function finiteNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function normalizeAnalyticsCostCode(value: unknown): string {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized || "UNASSIGNED";
}

export function analyticsPeriod(value: string | Date | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 7);
}

export function aggregateCostCodeSales(lines: CostCodeSalesLine[]): CostCodeMonthlyMetric[] {
  const groups = new Map<string, {
    period: string;
    costCode: string;
    costCodeName: string | null;
    reportingGroup: string;
    topLevelGroup: string;
    sales: number;
    cost: number;
    lineCount: number;
    projectIds: Set<string>;
  }>();

  for (const line of lines) {
    const period = analyticsPeriod(line.periodDate);
    if (!period) continue;
    const costCode = normalizeAnalyticsCostCode(line.costCode);
    const reportingGroup = String(line.reportingGroup || line.costCodeName || "Unmapped cost items").trim();
    const topLevelGroup = String(line.topLevelGroup || "Unassigned").trim();
    const key = `${period}:${topLevelGroup}:${reportingGroup}:${costCode}`;
    const group = groups.get(key) ?? {
      period,
      costCode,
      costCodeName: String(line.costCodeName ?? "").trim() || null,
      reportingGroup,
      topLevelGroup,
      sales: 0,
      cost: 0,
      lineCount: 0,
      projectIds: new Set<string>(),
    };

    group.sales += finiteNumber(line.itemSales) + finiteNumber(line.laborSales);
    group.cost += finiteNumber(line.itemCost) + finiteNumber(line.laborCost);
    group.lineCount += 1;
    if (!group.costCodeName) group.costCodeName = String(line.costCodeName ?? "").trim() || null;
    if (line.projectId) group.projectIds.add(line.projectId);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      const [year, month] = group.period.split("-").map(Number);
      const profit = group.sales - group.cost;
      return {
        period: group.period,
        year,
        month,
        costCode: group.costCode,
        costCodeName: group.costCodeName,
        reportingGroup: group.reportingGroup,
        topLevelGroup: group.topLevelGroup,
        sales: group.sales,
        cost: group.cost,
        profit,
        marginPercent: group.sales ? (profit / group.sales) * 100 : null,
        projectCount: group.projectIds.size,
        lineCount: group.lineCount,
      };
    })
    .sort((left, right) => left.period.localeCompare(right.period) || left.costCode.localeCompare(right.costCode));
}
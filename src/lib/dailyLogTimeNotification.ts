/** Daily log quantities are hours only when the exact PO line says Labor + hours. */
export type DailyLogTimeLine = {
  id: string;
  procoreId: string | null;
  procoreCompanyId: string | null;
  procoreProjectId: string | null;
  date: Date;
  lineItemId: string | null;
  lineItemHolderId: string | null;
  lineItemHolderType: string | null;
  lineItemDescription: string | null;
  quantityUsed: number | null;
  procoreDeletedAt: Date | null;
  procoreCreatedAt: Date | null;
  procoreUpdatedAt: Date | null;
  createdByName: string | null;
};

export type DailyLogTimeItem = {
  procoreId: string | null;
  procoreCompanyId: string | null;
  procoreProjectId: string | null;
  procorePurchaseOrderContractId: string | null;
  costType: string | null;
  uom: string | null;
  description: string | null;
};

export const DAILY_LOG_TIME_PREFIX = "productivity:";
// A separate rollout boundary prevents historical productivity syncs sending old emails.
export const DAILY_LOG_TIME_NOT_BEFORE = "2026-10-13T00:00:00.000Z";

export function dailyLogTimeKey(date: Date) {
  return `${DAILY_LOG_TIME_PREFIX}${date.toISOString().slice(0, 10)}`;
}

export function classifyDailyLogTimeLines(
  logs: DailyLogTimeLine[],
  items: DailyLogTimeItem[],
  companyId: string,
  projectId: string,
) {
  const seen = new Set<string>();
  let unresolved = 0;
  const lines = logs.flatMap((log) => {
    if (!log.procoreId || seen.has(log.procoreId) || log.procoreDeletedAt
      || log.procoreCompanyId !== companyId || log.procoreProjectId !== projectId
      || log.lineItemHolderType !== "PurchaseOrderContract"
      || !log.lineItemId || !log.lineItemHolderId
      || !Number.isFinite(log.quantityUsed) || !(log.quantityUsed! > 0)) return [];
    const matches = items.filter((item) => item.procoreId === log.lineItemId
      && item.procoreCompanyId === companyId && item.procoreProjectId === projectId
      && item.procorePurchaseOrderContractId === log.lineItemHolderId);
    // Ambiguous or unavailable PO metadata cannot establish that a quantity is hours.
    if (matches.length !== 1) { unresolved += 1; return []; }
    const item = matches[0];
    if (!item.costType?.trim() || (/^(labor|l)$/i.test(item.costType.trim()) && !item.uom?.trim())) {
      unresolved += 1;
      return [];
    }
    if (!/^(labor|l)$/i.test(item.costType?.trim() || "")
      || !/^(h|hr|hrs|hour|hours)$/i.test(item.uom?.trim() || "")) return [];
    seen.add(log.procoreId);
    return [{
      ...log,
      description: item.description || log.lineItemDescription || "Labor",
      hours: log.quantityUsed!,
    }];
  });
  return { lines, unresolved };
}

export function selectDailyLogTimeLines(
  logs: DailyLogTimeLine[], items: DailyLogTimeItem[], companyId: string, projectId: string,
) {
  return classifyDailyLogTimeLines(logs, items, companyId, projectId).lines;
}

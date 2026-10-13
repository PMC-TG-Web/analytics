import { prisma } from "./prisma";
import {
  DAILY_LOG_TIME_NOT_BEFORE,
  dailyLogTimeKey,
  classifyDailyLogTimeLines,
} from "./dailyLogTimeNotification";

export async function loadDailyLogTimeLines(companyId: string, projectId: string, date: Date) {
  const end = new Date(date.getTime() + 86_400_000);
  const logs = await prisma.productivityLog.findMany({
    where: { procoreCompanyId: companyId, procoreProjectId: projectId, date: { gte: date, lt: end } },
    select: {
      id: true, procoreId: true, procoreCompanyId: true, procoreProjectId: true, date: true,
      lineItemId: true, lineItemHolderId: true, lineItemHolderType: true,
      lineItemDescription: true, quantityUsed: true, procoreDeletedAt: true,
      procoreCreatedAt: true, procoreUpdatedAt: true, createdByName: true,
    },
    orderBy: { procoreId: "asc" },
  });
  const ids = [...new Set(logs.filter((log) => !log.procoreDeletedAt).map((log) => log.lineItemId).filter(Boolean))];
  const items = ids.length ? await prisma.purchaseOrderLineItemContractDetail.findMany({
    where: { procoreCompanyId: companyId, procoreProjectId: projectId, procoreId: { in: ids } },
    select: {
      procoreId: true, procoreCompanyId: true, procoreProjectId: true,
      procorePurchaseOrderContractId: true, costType: true, uom: true, description: true,
    },
  }) : [];
  return {
    ...classifyDailyLogTimeLines(logs, items, companyId, projectId),
    allDeleted: logs.length > 0 && logs.every((log) => Boolean(log.procoreDeletedAt)),
  };
}

export async function enqueueDailyLogTimeNotifications(
  logs: Record<string, unknown>[],
  params: { companyId?: string; projectId: string },
) {
  const companyId = params.companyId?.trim();
  // Keep the existing notification system's activation gate.
  if (!companyId || !process.env.TIMECARD_NOTIFICATION_NOT_BEFORE) return 0;
  const notBefore = new Date(process.env.PRODUCTIVITY_TIME_NOTIFICATION_NOT_BEFORE || DAILY_LOG_TIME_NOT_BEFORE);
  const timecardNotBefore = new Date(process.env.TIMECARD_NOTIFICATION_NOT_BEFORE);
  if (!Number.isFinite(notBefore.getTime()) || !Number.isFinite(timecardNotBefore.getTime())) return 0;
  const cutoff = Math.max(notBefore.getTime(), timecardNotBefore.getTime());
  const dates = new Set<string>();
  for (const log of logs) {
    const created = new Date(String(log.created_at || ""));
    const date = String(log.log_date ?? log.date ?? "").slice(0, 10);
    if (created.getTime() >= cutoff && /^\d{4}-\d{2}-\d{2}$/.test(date)
      && Number.isFinite(new Date(date).getTime())) dates.add(date);
  }
  const delaySeconds = Math.min(1_800, Math.max(0,
    Number.parseInt(process.env.TIMECARD_NOTIFICATION_DELAY_SECONDS || "120", 10) || 0));
  let queued = 0;
  for (const dateText of dates) {
    const date = new Date(`${dateText}T00:00:00.000Z`);
    const { lines, unresolved } = await loadDailyLogTimeLines(companyId, params.projectId, date);
    if (unresolved || !lines.length || lines.some((line) => !line.procoreCreatedAt
      || line.procoreCreatedAt.getTime() < cutoff)) continue;
    const result = await prisma.timecardNotification.createMany({
      data: [{
        companyId, projectId: params.projectId, timesheetId: dailyLogTimeKey(date),
        timecardDate: date,
        createdByName: [...new Set(lines.map((line) => line.createdByName).filter(Boolean))].join(", ") || null,
        availableAt: new Date(Date.now() + delaySeconds * 1_000),
      }],
      skipDuplicates: true,
    });
    queued += result.count;
  }
  return queued;
}

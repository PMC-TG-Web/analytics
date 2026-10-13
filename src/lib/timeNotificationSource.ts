import { prisma } from "./prisma";
import { DAILY_LOG_TIME_PREFIX, dailyLogTimeKey } from "./dailyLogTimeNotification";
import { loadDailyLogTimeLines } from "./dailyLogTimeNotificationStore";

export async function loadTimeNotificationSource(candidate: {
  companyId: string; projectId: string; timesheetId: string; timecardDate: Date | null;
}) {
  if (candidate.timesheetId.startsWith(DAILY_LOG_TIME_PREFIX)) {
    if (!candidate.timecardDate || dailyLogTimeKey(candidate.timecardDate) !== candidate.timesheetId) {
      throw new Error("Daily productivity notification has an invalid work date.");
    }
    const { lines, allDeleted, unresolved } = await loadDailyLogTimeLines(
      candidate.companyId, candidate.projectId, candidate.timecardDate,
    );
    if (unresolved) throw new Error("Daily productivity PO coding is missing or ambiguous; hourly labor totals are not complete yet.");
    return {
      source: "productivity" as const,
      entries: lines.map((line) => ({ partyName: line.description, hours: line.hours })),
      createdByName: [...new Set(lines.map((line) => line.createdByName).filter(Boolean))].join(", ") || null,
      allDeleted,
    };
  }

  // Read retained deletion evidence as well as active lines; an empty sync is
  // retryable, whereas a timesheet whose known lines were deleted is obsolete.
  const rows = await prisma.$queryRaw<Array<{
    party_name: string | null; hours: number | null;
    created_by_name: string | null; deleted_at: Date | null;
  }>>`
    SELECT "partyName" AS party_name, "hours" AS hours,
      "createdByName" AS created_by_name, "procoreDeletedAt" AS deleted_at
    FROM "TimecardEntry"
    WHERE "procoreProjectId" = ${candidate.projectId}
      AND "procoreCompanyId" = ${candidate.companyId}
      AND COALESCE(
        "customFields" #>> '{originalData,timesheet_id}',
        "customFields" #>> '{originalData,_timesheet_id}',
        "customFields" #>> '{originalData,origin_data,timesheet_id}',
        "customFields" #>> '{originalData,origin_data,timesheetId}'
      ) = ${candidate.timesheetId}
    ORDER BY "procoreId"
  `;
  const active = rows.filter((line) => !line.deleted_at);
  return {
    source: "timecard" as const,
    entries: active.map((line) => ({ partyName: line.party_name, hours: line.hours })),
    createdByName: active.find((line) => line.created_by_name)?.created_by_name || null,
    allDeleted: rows.length > 0 && active.length === 0,
  };
}

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

function getMonthRange(month: string): { start: string; end: string } {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;

  const startDate = new Date(Date.UTC(year, monthIndex, 1));
  const endDate = new Date(Date.UTC(year, monthIndex + 1, 0));

  return {
    start: startDate.toISOString().slice(0, 10),
    end: endDate.toISOString().slice(0, 10),
  };
}

function toIsoWeekKey(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function parseJobKey(jobKey: string): { customer: string; projectNumber: string; projectName: string } {
  const [customer = "", projectNumber = "", projectName = ""] = jobKey.split("~");
  return { customer, projectNumber, projectName };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const jobKey = String(searchParams.get("jobKey") || "").trim();
    const scopeOfWork = String(searchParams.get("scopeOfWork") || "").trim() || null;
    const month = String(searchParams.get("month") || "").trim() || null;

    if (!jobKey) {
      return NextResponse.json(
        {
          success: false,
          error: "jobKey is required",
        },
        { status: 400 }
      );
    }

    if (month && !isValidMonth(month)) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid month format. Use YYYY-MM",
        },
        { status: 400 }
      );
    }

    const activeWhere: {
      jobKey: string;
      scopeOfWork?: string;
      date?: { gte: string; lte: string };
    } = { jobKey };

    if (scopeOfWork) {
      activeWhere.scopeOfWork = scopeOfWork;
    }

    let monthRange: { start: string; end: string } | null = null;
    if (month) {
      monthRange = getMonthRange(month);
      activeWhere.date = {
        gte: monthRange.start,
        lte: monthRange.end,
      };
    }

    const { customer, projectName } = parseJobKey(jobKey);

    const [schedule, projectScopes, ganttScopes, trackingRows, activeRows] = await Promise.all([
      prisma.schedule.findUnique({
        where: { jobKey },
        select: {
          id: true,
          jobKey: true,
          customer: true,
          projectNumber: true,
          projectName: true,
          status: true,
          totalHours: true,
          allocationsList: {
            select: {
              period: true,
              periodType: true,
              hours: true,
              percent: true,
            },
            orderBy: { period: "asc" },
          },
        },
      }),
      prisma.projectScope.findMany({
        where: {
          jobKey,
          ...(scopeOfWork ? { title: scopeOfWork } : {}),
        },
        select: {
          id: true,
          title: true,
          startDate: true,
          endDate: true,
          manpower: true,
          hours: true,
        },
      }),
      prisma.$queryRawUnsafe<Array<{
        id: string;
        title: string;
        start_date: Date | null;
        end_date: Date | null;
        total_hours: number;
        crew_size: number | null;
      }>>(
        `
          SELECT
            s.id,
            s.title,
            s.start_date,
            s.end_date,
            s.total_hours,
            s.crew_size
          FROM gantt_v2_projects p
          JOIN gantt_v2_scopes s ON s.project_id = p.id
          WHERE COALESCE(p.customer, '') = $1
            AND COALESCE(p.project_name, '') = $2
            ${scopeOfWork ? "AND s.title = $3" : ""}
          ORDER BY s.created_at ASC
        `,
        ...(scopeOfWork
          ? [customer, projectName, scopeOfWork]
          : [customer, projectName])
      ),
      prisma.scopeTracking.findMany({
        where: {
          jobKey,
          ...(scopeOfWork ? { scopeOfWork } : {}),
        },
        select: {
          scopeOfWork: true,
          totalHours: true,
          scheduledHours: true,
          unscheduledHours: true,
          lastUpdated: true,
        },
      }),
      prisma.activeSchedule.findMany({
        where: activeWhere,
        select: {
          scopeOfWork: true,
          date: true,
          hours: true,
          manpower: true,
          foreman: true,
          source: true,
          lastModified: true,
        },
        orderBy: [{ date: "asc" }, { scopeOfWork: "asc" }],
      }),
    ]);

    if (!schedule) {
      return NextResponse.json(
        {
          success: false,
          error: "Schedule not found for jobKey",
        },
        { status: 404 }
      );
    }

    const relevantAllocations = schedule.allocationsList.filter((alloc) => {
      if (!month) return true;
      if (alloc.periodType === "month") return alloc.period === month;
      return alloc.period.startsWith(month.slice(0, 4));
    });

    const monthlyPlannedHours = relevantAllocations
      .filter((a) => a.periodType === "month")
      .reduce((sum, a) => sum + (a.hours || 0), 0);

    const weeklyPlannedHours = relevantAllocations
      .filter((a) => a.periodType === "week")
      .reduce((sum, a) => sum + (a.hours || 0), 0);

    const canonicalScopes = ganttScopes.length > 0
      ? ganttScopes.map((scope) => ({
          id: scope.id,
          title: scope.title,
          startDate: scope.start_date ? scope.start_date.toISOString().slice(0, 10) : null,
          endDate: scope.end_date ? scope.end_date.toISOString().slice(0, 10) : null,
          manpower: scope.crew_size,
          hours: scope.total_hours,
        }))
      : projectScopes;

    const scopePlannedHours = canonicalScopes.reduce((sum, s) => sum + (s.hours || 0), 0);
    const scheduledHours = activeRows.reduce((sum, row) => sum + (row.hours || 0), 0);

    const bySource: Record<string, number> = {};
    const byWeek: Record<string, number> = {};
    const byScope: Record<string, { plannedHours: number; scheduledHours: number; driftHours: number }> = {};

    for (const row of activeRows) {
      bySource[row.source] = (bySource[row.source] || 0) + (row.hours || 0);
      const weekKey = toIsoWeekKey(row.date);
      byWeek[weekKey] = (byWeek[weekKey] || 0) + (row.hours || 0);

      if (!byScope[row.scopeOfWork]) {
        byScope[row.scopeOfWork] = {
          plannedHours: 0,
          scheduledHours: 0,
          driftHours: 0,
        };
      }
      byScope[row.scopeOfWork].scheduledHours += row.hours || 0;
    }

    for (const scope of canonicalScopes) {
      if (!byScope[scope.title]) {
        byScope[scope.title] = {
          plannedHours: 0,
          scheduledHours: 0,
          driftHours: 0,
        };
      }
      byScope[scope.title].plannedHours += scope.hours || 0;
    }

    for (const key of Object.keys(byScope)) {
      const item = byScope[key];
      item.driftHours = item.scheduledHours - item.plannedHours;
    }

    const totals = {
      monthlyPlannedHours,
      weeklyPlannedHours,
      scopePlannedHours,
      scheduledHours,
      remainingScopeHours: scopePlannedHours - scheduledHours,
      driftVsScopePlanHours: scheduledHours - scopePlannedHours,
      driftVsMonthlyPlanHours: scheduledHours - monthlyPlannedHours,
    };

    return NextResponse.json({
      success: true,
      data: {
        filters: {
          jobKey,
          scopeOfWork,
          month,
          monthRange,
        },
        schedule: {
          id: schedule.id,
          jobKey: schedule.jobKey,
          customer: schedule.customer,
          projectNumber: schedule.projectNumber,
          projectName: schedule.projectName,
          status: schedule.status,
          totalHours: schedule.totalHours,
        },
        totals,
        allocations: relevantAllocations,
        scopes: canonicalScopes,
        tracking: trackingRows,
        active: {
          count: activeRows.length,
          bySource,
          byWeek,
          byScope,
          rows: activeRows,
        },
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: `Failed to run scheduling diagnostics: ${String(error)}`,
      },
      { status: 500 }
    );
  }
}

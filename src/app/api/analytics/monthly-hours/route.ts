import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getKpiCardYearValues } from "@/lib/kpiCardMonths";

export const dynamic = "force-dynamic";

type DbValue = bigint | number | string | Date | null;
type DbRow = Record<string, DbValue>;

function numberValue(value: unknown): number {
  if (typeof value === "bigint") return Number(value);
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textValue(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function readKpiRowValues(
  cards: Array<{ name: string; value: string }>,
  cardName: string,
  rowName: string,
  year: number,
): string[] {
  const card = cards.find((entry) => entry.name === cardName);
  if (!card) return [];
  try {
    const payload = JSON.parse(card.value) as {
      rows?: Array<{ kpi?: string; values?: string[] }>;
    };
    const row = payload.rows?.find(
      (entry) => String(entry.kpi || "").trim().toLowerCase() === rowName.toLowerCase(),
    );
    return getKpiCardYearValues(row?.values, year);
  } catch {
    return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const companyId = String(
      request.nextUrl.searchParams.get("companyId") || process.env.PROCORE_COMPANY_ID || "",
    ).trim();
    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
    }

    const [projectRows, monthlyRows, kpiCards] = await Promise.all([
      prisma.$queryRawUnsafe<DbRow[]>(
        `
          WITH active_projects AS (
            SELECT company_id, procore_project_id, project_number, project_name, customer, status
            FROM pmc_projects
            WHERE company_id = $1
              AND LOWER(BTRIM(COALESCE(status, ''))) IN ('in progress', 'active', 'course of construction')
          ),
          budget AS (
            SELECT project_id, SUM(COALESCE(quantity, 0))::double precision AS original_hours
            FROM budgetlineitems
            WHERE company_id = $1 AND cost_code ~* '\\.L$'
            GROUP BY project_id
          ),
          changes AS (
            SELECT project_id, SUM(COALESCE(labor_hours, 0))::double precision AS change_hours
            FROM procore_change_order_package_lines
            WHERE company_id = $1
              AND LOWER(COALESCE(package_status, '')) IN ('approved', 'executed', 'complete', 'completed')
              AND labor_hours IS NOT NULL
            GROUP BY project_id
          ),
          timecards AS (
            SELECT "procoreProjectId" AS project_id,
              SUM(COALESCE(hours, "totalHoursWorked", 0))::double precision AS used_hours
            FROM "TimecardEntry"
            WHERE "procoreCompanyId" = $1
              AND "procoreProjectId" IS NOT NULL
              AND "procoreDeletedAt" IS NULL
            GROUP BY "procoreProjectId"
          ),
          closeouts AS (
            SELECT c.procore_project_id AS project_id,
              SUM(LEAST(
                c.adjustment_quantity,
                GREATEST(c.expected_quantity - COALESCE((
                  SELECT SUM(COALESCE(t.hours, t."totalHoursWorked", 0))
                  FROM "TimecardEntry" t
                  WHERE t."procoreCompanyId" = c.company_id
                    AND t."procoreProjectId" = c.procore_project_id
                    AND UPPER(BTRIM(COALESCE(t."costCodeFullCode", ''))) = '01-300-10-20'
                    AND t."procoreDeletedAt" IS NULL
                ), 0), 0)
              ))::double precision AS used_hours
            FROM forms_productivity_closeouts c
            WHERE c.company_id = $1
              AND c.kind = 'project_management_closeout'
              AND c.status IN ('created', 'detected_existing')
              AND c.procore_log_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM "ProductivityLog" p
                WHERE p."procoreCompanyId" = c.company_id
                  AND p."procoreProjectId" = c.procore_project_id
                  AND p."procoreId" = c.procore_log_id
                  AND COALESCE(p."lineItemHolderTitle", '') ILIKE '%Billing File%'
              )
            GROUP BY c.procore_project_id
          )
          SELECT
            p.procore_project_id AS project_id,
            p.project_number,
            p.project_name,
            p.customer,
            p.status,
            COALESCE(b.original_hours, 0)::double precision AS original_hours,
            COALESCE(c.change_hours, 0)::double precision AS change_hours,
            (COALESCE(b.original_hours, 0) + COALESCE(c.change_hours, 0))::double precision AS expected_hours,
            (COALESCE(t.used_hours, 0) + COALESCE(x.used_hours, 0))::double precision AS used_hours,
            (COALESCE(b.original_hours, 0) + COALESCE(c.change_hours, 0)
              - COALESCE(t.used_hours, 0) - COALESCE(x.used_hours, 0))::double precision AS remaining_hours
          FROM active_projects p
          LEFT JOIN budget b ON b.project_id = p.procore_project_id
          LEFT JOIN changes c ON c.project_id = p.procore_project_id
          LEFT JOIN timecards t ON t.project_id = p.procore_project_id
          LEFT JOIN closeouts x ON x.project_id = p.procore_project_id
          ORDER BY p.project_name, p.project_number
        `,
        companyId,
      ),
      prisma.$queryRawUnsafe<DbRow[]>(
        `
          WITH active_projects AS (
            SELECT procore_project_id
            FROM pmc_projects
            WHERE company_id = $1
              AND LOWER(BTRIM(COALESCE(status, ''))) IN ('in progress', 'active', 'course of construction')
          ),
          monthly_entries AS (
            SELECT DATE_TRUNC('month', t.date) AS month,
              COALESCE(t.hours, t."totalHoursWorked", 0)::double precision AS hours
            FROM "TimecardEntry" t
            JOIN active_projects p ON p.procore_project_id = t."procoreProjectId"
            WHERE t."procoreCompanyId" = $1
              AND t."procoreDeletedAt" IS NULL
              AND t.date IS NOT NULL

            UNION ALL

            SELECT DATE_TRUNC('month', c.accounting_date::timestamp) AS month,
              LEAST(
                c.adjustment_quantity,
                GREATEST(c.expected_quantity - COALESCE((
                  SELECT SUM(COALESCE(t2.hours, t2."totalHoursWorked", 0))
                  FROM "TimecardEntry" t2
                  WHERE t2."procoreCompanyId" = c.company_id
                    AND t2."procoreProjectId" = c.procore_project_id
                    AND UPPER(BTRIM(COALESCE(t2."costCodeFullCode", ''))) = '01-300-10-20'
                    AND t2."procoreDeletedAt" IS NULL
                ), 0), 0)
              )::double precision AS hours
            FROM forms_productivity_closeouts c
            JOIN active_projects p ON p.procore_project_id = c.procore_project_id
            WHERE c.company_id = $1
              AND c.kind = 'project_management_closeout'
              AND c.status IN ('created', 'detected_existing')
              AND c.procore_log_id IS NOT NULL
              AND c.accounting_date IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM "ProductivityLog" pl
                WHERE pl."procoreCompanyId" = c.company_id
                  AND pl."procoreProjectId" = c.procore_project_id
                  AND pl."procoreId" = c.procore_log_id
                  AND COALESCE(pl."lineItemHolderTitle", '') ILIKE '%Billing File%'
              )
          )
          SELECT TO_CHAR(month, 'YYYY-MM') AS month,
            SUM(hours)::double precision AS used_hours
          FROM monthly_entries
          GROUP BY month
          ORDER BY month
        `,
        companyId,
      ),
      prisma.estimatingConstant.findMany({
        where: {
          category: "KPI_CARDS",
          name: {
            in: [
              "kpi-card:revenue-hours-by-month",
              "kpi-card:revenue-by-month",
              "kpi-card:subs-by-month",
            ],
          },
        },
        select: { name: true, value: true, updatedAt: true },
      }),
    ]);

    const projects = projectRows.map((row) => ({
      projectId: String(row.project_id),
      projectNumber: textValue(row.project_number),
      projectName: textValue(row.project_name) || String(row.project_id),
      customer: textValue(row.customer),
      status: textValue(row.status),
      originalHours: numberValue(row.original_hours),
      changeHours: numberValue(row.change_hours),
      expectedHours: numberValue(row.expected_hours),
      usedHours: numberValue(row.used_hours),
      remainingHours: numberValue(row.remaining_hours),
    }));
    const monthly = monthlyRows.map((row) => ({
      month: String(row.month),
      usedHours: numberValue(row.used_hours),
    }));
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const revenueHoursCard = kpiCards.find((card) => card.name === "kpi-card:revenue-hours-by-month");
    const revenueActualValues = readKpiRowValues(
      kpiCards,
      "kpi-card:revenue-hours-by-month",
      "Revenue Actual Hours",
      currentYear,
    );
    const populatedYtdHours = revenueActualValues
      .slice(0, currentMonth)
      .map((value, index) => ({
        month: index + 1,
        value: String(value || "").trim(),
      }))
      .filter((entry) => entry.value !== "")
      .map((entry) => ({
        month: entry.month,
        hours: Number(entry.value.replace(/[^0-9.-]/g, "")),
      }))
      .filter((entry) => Number.isFinite(entry.hours));
    const averageMonthlyHours = populatedYtdHours.length > 0
      ? populatedYtdHours.reduce((sum, entry) => sum + entry.hours, 0) / populatedYtdHours.length
      : 0;
    const formatPeriod = (month: number) => `${currentYear}-${String(month).padStart(2, "0")}`;
    const expectedHours = projects.reduce((sum, project) => sum + project.expectedHours, 0);
    const usedHours = projects.reduce((sum, project) => sum + project.usedHours, 0);
    const remainingHours = projects.reduce((sum, project) => sum + project.remainingHours, 0);
    const leadTimeMonths = averageMonthlyHours > 0
      ? Math.max(remainingHours, 0) / averageMonthlyHours
      : null;
    const actualRevenueValues = readKpiRowValues(
      kpiCards,
      "kpi-card:revenue-by-month",
      "Monthly Actual Revenue excluding subcontracted",
      currentYear,
    );
    const subRevenueValues = readKpiRowValues(
      kpiCards,
      "kpi-card:subs-by-month",
      "Monthly Sub Actual Revenue Billed",
      currentYear,
    );
    const revenueMonthly = Array.from({ length: currentMonth }, (_, index) => {
      const actualText = String(actualRevenueValues[index] || "").trim();
      const subText = String(subRevenueValues[index] || "").trim();
      if (!actualText && !subText) return null;
      const actualRevenue = Number(actualText.replace(/[^0-9.-]/g, ""));
      const subRevenue = Number(subText.replace(/[^0-9.-]/g, ""));
      return {
        month: formatPeriod(index + 1),
        actualRevenue: Number.isFinite(actualRevenue) ? actualRevenue : 0,
        subRevenue: Number.isFinite(subRevenue) ? subRevenue : 0,
        totalRevenue:
          (Number.isFinite(actualRevenue) ? actualRevenue : 0)
          + (Number.isFinite(subRevenue) ? subRevenue : 0),
      };
    }).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    const averageMonthlyRevenue = revenueMonthly.length > 0
      ? revenueMonthly.reduce((sum, entry) => sum + entry.totalRevenue, 0) / revenueMonthly.length
      : 0;
    const revenueSourceUpdatedAt = kpiCards
      .filter((card) => card.name === "kpi-card:revenue-by-month" || card.name === "kpi-card:subs-by-month")
      .reduce<Date | null>(
        (latest, card) => !latest || card.updatedAt > latest ? card.updatedAt : latest,
        null,
      );

    return NextResponse.json({
      success: true,
      generatedAt: now.toISOString(),
      summary: {
        projectCount: projects.length,
        expectedHours,
        usedHours,
        remainingHours,
        averageMonthlyHours,
        leadTimeMonths,
        averageMonthCount: populatedYtdHours.length,
        averagePeriodStart: populatedYtdHours[0]
          ? formatPeriod(populatedYtdHours[0].month)
          : null,
        averagePeriodEnd: populatedYtdHours.at(-1)
          ? formatPeriod(populatedYtdHours.at(-1)!.month)
          : null,
        averageSource: "KPI Revenue Actual Hours",
        averageSourceUpdatedAt: revenueHoursCard?.updatedAt.toISOString() ?? null,
      },
      monthly,
      revenueMonthly,
      revenueSummary: {
        averageMonthlyRevenue,
        averageMonthCount: revenueMonthly.length,
        averagePeriodStart: revenueMonthly[0]?.month ?? null,
        averagePeriodEnd: revenueMonthly.at(-1)?.month ?? null,
        projectedRevenue: leadTimeMonths === null ? null : averageMonthlyRevenue * leadTimeMonths,
        sourceUpdatedAt: revenueSourceUpdatedAt?.toISOString() ?? null,
      },
      projects,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, error: "Failed to load monthly labor hours.", details: message },
      { status: 500 },
    );
  }
}
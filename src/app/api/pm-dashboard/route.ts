import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getRequestUserEmail } from "@/lib/requestUser";
import { nextCalendarDateKeys, PM_DASHBOARD_TIME_ZONE } from "@/lib/pmDashboard";

export const dynamic = "force-dynamic";

type DashboardRow = {
  id: string;
  source_type: string;
  source_id: string;
  number: string | null;
  title: string;
  description: string | null;
  status: string | null;
  due_at: Date | null;
  starts_at: Date | null;
  ends_at: Date | null;
  assignee_emails: string[];
  assignee_names: string[];
  source_url: string | null;
  synced_at: Date;
  procore_project_id: string;
  project_number: string | null;
  project_name: string;
  project_manager: string | null;
};

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export async function GET(request: NextRequest) {
  const email = await getRequestUserEmail(request);
  if (!email) return jsonNoStore({ success: false, error: "Authentication required." }, { status: 401 });

  try {
    const employee = await prisma.employee.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, isActive: true },
      select: { firstName: true, lastName: true },
    });
    const employeeName = employee ? `${employee.firstName} ${employee.lastName}`.trim().toLowerCase() : "";
    const reverseEmployeeName = employee ? `${employee.lastName}, ${employee.firstName}`.trim().toLowerCase() : "";
    const companyId = (process.env.PROCORE_COMPANY_ID || "598134325805519").trim();

    const items = await prisma.$queryRaw<DashboardRow[]>`
      SELECT
        i."id",
        i."source_type",
        i."source_id",
        i."number",
        i."title",
        i."description",
        i."status",
        i."due_at",
        i."starts_at",
        i."ends_at",
        i."assignee_emails",
        i."assignee_names",
        i."source_url",
        i."synced_at",
        i."procore_project_id",
        p."project_number",
        p."project_name",
        p."project_manager"
      FROM "pmc_action_items" i
      INNER JOIN "pmc_projects" p
        ON p."company_id" = i."company_id"
       AND p."procore_project_id" = i."procore_project_id"
      WHERE i."company_id" = ${companyId}
        AND i."is_open" = true
        AND i."due_at" IS NOT NULL
        AND i."due_at" < (
          ((CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date + INTERVAL '5 days')
          AT TIME ZONE 'America/New_York'
        )
        AND (
          i."source_type" <> 'meeting'
          OR i."due_at" >= (
            (CURRENT_TIMESTAMP AT TIME ZONE 'America/New_York')::date
            AT TIME ZONE 'America/New_York'
          )
        )
        AND (
          ${email} = ANY(i."assignee_emails")
          OR (
            ${employeeName} <> ''
            AND lower(trim(COALESCE(p."project_manager", ''))) IN (${employeeName}, ${reverseEmployeeName})
          )
          OR lower(trim(COALESCE(p."project_manager", ''))) = ${email}
        )
      ORDER BY i."due_at" ASC, p."project_name" ASC, i."title" ASC
    `;

    const latestItemSync = items.reduce<Date | null>((latest, item) => {
      if (!latest || item.synced_at > latest) return item.synced_at;
      return latest;
    }, null);
    const latestState = await prisma.$queryRaw<Array<{ latest: Date | null }>>`
      SELECT MAX("last_success_at") AS "latest"
      FROM "pmc_action_item_sync_state"
      WHERE "company_id" = ${companyId}
    `;
    const latestSync = latestItemSync && latestState[0]?.latest
      ? (latestItemSync > latestState[0].latest ? latestItemSync : latestState[0].latest)
      : latestItemSync || latestState[0]?.latest || null;

    return jsonNoStore({
      success: true,
      user: {
        email,
        name: employee ? `${employee.firstName} ${employee.lastName}`.trim() : email.split("@")[0],
      },
      window: {
        timeZone: PM_DASHBOARD_TIME_ZONE,
        dateKeys: nextCalendarDateKeys(new Date(), 5),
      },
      latestSync: latestSync?.toISOString() || null,
      items: items.map((item) => ({
        id: item.id,
        type: item.source_type,
        sourceId: item.source_id,
        number: item.number,
        title: item.title,
        description: item.description,
        status: item.status,
        dueAt: item.due_at?.toISOString() || null,
        startsAt: item.starts_at?.toISOString() || null,
        endsAt: item.ends_at?.toISOString() || null,
        assigneeEmails: item.assignee_emails,
        assigneeNames: item.assignee_names,
        sourceUrl: item.source_url,
        project: {
          id: item.procore_project_id,
          number: item.project_number,
          name: item.project_name,
          manager: item.project_manager,
        },
      })),
    });
  } catch (error) {
    console.error("Failed to load PM dashboard:", error);
    return jsonNoStore(
      { success: false, error: "The PM work queue is temporarily unavailable." },
      { status: 503 },
    );
  }
}

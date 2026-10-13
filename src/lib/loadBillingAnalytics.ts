import { prisma } from '@/lib/prisma';
import { aggregateBillingHours, billingMonthRange, type BillingHourEntry } from './billingAnalytics';

/** Reporting reads only the synchronized mirrors; explicit company/project IDs scope every join. */
export async function loadBillingAnalytics(companyId: string, from: string, through: string) {
  const { start, end } = billingMonthRange(from, through);
  const entries = await prisma.$queryRaw<BillingHourEntry[]>`
    WITH sources AS (
      SELECT t.id, t."procoreId", t."procoreCompanyId" AS "companyId", t."procoreProjectId" AS "projectId",
        'timesheet'::text AS source, t.date AT TIME ZONE 'UTC' AS date, t."updatedAt", t."procoreDeletedAt" AS "deletedAt",
        COALESCE(t.hours, t."totalHoursWorked") AS hours, t."costCodeFullCode" AS "costCode", t."costCodeName",
        t.description, t."partyName", t.party, t.status, t.description AS notes, 'hr'::text AS uom
      FROM "TimecardEntry" t
      WHERE t."procoreCompanyId" = ${companyId} AND t.date >= ${start} AND t.date < ${end}
        AND (t."partyName" ILIKE '%sub%' OR t.party ILIKE '%sub%')
      UNION ALL
      SELECT p.id, p."procoreId", p."procoreCompanyId", p."procoreProjectId", 'productivity', p.date,
        p."updatedAt", p."procoreDeletedAt", p."quantityUsed", li."costCode", NULL::text,
        COALESCE(li.description, p."lineItemDescription"), NULL::text, NULL::text, p.status, p.notes, li.uom
      FROM "ProductivityLog" p
      LEFT JOIN analytics_po_line_aliases a ON a.company_id = p."procoreCompanyId"
        AND a.procore_project_id = p."procoreProjectId" AND a.source_line_item_id = p."lineItemId"
      LEFT JOIN LATERAL (
        -- Repeated mirror rows must never multiply a log. Conflicting codes remain unassigned.
        SELECT CASE WHEN COUNT(DISTINCT UPPER(BTRIM(i."costCode"))) = 1 THEN MAX(UPPER(BTRIM(i."costCode"))) END AS "costCode",
          CASE WHEN COUNT(DISTINCT i.description) = 1 THEN MAX(i.description) END AS description,
          CASE WHEN COUNT(DISTINCT i.uom) = 1 THEN MAX(i.uom) END AS uom
        FROM "PurchaseOrderLineItemContractDetail" i
        WHERE i."procoreCompanyId" = p."procoreCompanyId" AND i."procoreProjectId" = p."procoreProjectId"
          AND i."procoreId" = COALESCE(a.target_line_item_id, p."lineItemId")
      ) li ON true
      WHERE p."procoreCompanyId" = ${companyId} AND p.date >= ${start} AND p.date < ${end}
        AND COALESCE(p."lineItemHolderTitle", '') NOT ILIKE '%Billing File%'
        AND (p."lineItemDescription" ILIKE '%sub%' OR li.description ILIKE '%sub%')
    )
    SELECT s.*, p.project_name AS "projectName", p.project_number AS "projectNumber"
    FROM sources s LEFT JOIN pmc_projects p ON p.company_id = s."companyId" AND p.procore_project_id = s."projectId"
    ORDER BY s."updatedAt" DESC, s.id
  `;
  return { companyId, from, through, ...aggregateBillingHours(entries, companyId), loadedAt: new Date().toISOString() };
}

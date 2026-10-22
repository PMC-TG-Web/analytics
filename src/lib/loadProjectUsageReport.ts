import { prisma } from '@/lib/prisma';
import { buildProjectUsageReport, usagePeriod, type UsageRecord } from './projectUsageReport.ts';

const PAGE_SIZE = 1000;

export async function loadProjectUsageReport(companyId: string, from: string, through: string) {
  const period = usagePeriod(from, through);
  // Filter dates AFTER choosing each source record's latest mirror, so a moved/deleted
  // entry cannot revive an older copy. UTC dates match the field source's work dates.
  const start = from ? new Date(`${from}T00:00:00Z`) : null;
  const end = through ? new Date(Date.parse(`${through}T00:00:00Z`) + 86_400_000) : null;
  async function read(source: 'Timecard' | 'Daily log') {
    const result: UsageRecord[] = [];
    let cursor = '';
    for (;;) {
      const rows = source === 'Timecard' ? await prisma.$queryRaw<UsageRecord[]>`
        WITH latest AS (
          SELECT DISTINCT ON (t."procoreProjectId", COALESCE(t."procoreId", 'local:' || t.id)) t.*
          FROM "TimecardEntry" t WHERE t."procoreCompanyId" = ${companyId}
          ORDER BY t."procoreProjectId", COALESCE(t."procoreId", 'local:' || t.id),
            COALESCE(t."procoreUpdatedAt", t."updatedAt") DESC, t."updatedAt" DESC, t.id DESC
        )
        SELECT t.id, t."procoreId" AS "sourceId", t."procoreCompanyId" AS "companyId", t."procoreProjectId" AS "projectId",
          'Timecard'::text AS source, TO_CHAR(t.date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
          t."updatedAt", t."procoreDeletedAt" AS "deletedAt", t.status, COALESCE(t.hours, t."totalHoursWorked") AS quantity,
          t."costCodeFullCode" AS "costCode", t."costCodeName" AS description,
          COALESCE(NULLIF(BTRIM(t."partyName"), ''), t.party) AS worker,
          NULL::text AS "holderId", NULL::text AS "lineItemId", 'L'::text AS "costType", 'HR'::text AS uom,
          NULL::text AS "holderTitle", 1 AS "metadataMatches"
        FROM latest t WHERE t.id > ${cursor} AND (${start}::timestamptz IS NULL OR t.date >= ${start})
          AND (${end}::timestamptz IS NULL OR t.date < ${end}) ORDER BY t.id LIMIT ${PAGE_SIZE}
      ` : await prisma.$queryRaw<UsageRecord[]>`
        WITH latest AS (
          SELECT DISTINCT ON (p."procoreProjectId", COALESCE(p."procoreId", 'local:' || p.id)) p.*
          FROM "ProductivityLog" p WHERE p."procoreCompanyId" = ${companyId}
          ORDER BY p."procoreProjectId", COALESCE(p."procoreId", 'local:' || p.id),
            COALESCE(p."procoreUpdatedAt", p."updatedAt") DESC, p."updatedAt" DESC, p.id DESC
        )
        SELECT p.id, p."procoreId" AS "sourceId", p."procoreCompanyId" AS "companyId", p."procoreProjectId" AS "projectId",
          'Daily log'::text AS source, TO_CHAR(p.date, 'YYYY-MM-DD') AS date,
          p."updatedAt", p."procoreDeletedAt" AS "deletedAt", p.status, p."quantityUsed" AS quantity,
          li."costCode", COALESCE(li.description, p."lineItemDescription") AS description, p."lineItemDescription" AS "logDescription", NULL::text AS worker,
          COALESCE(a.target_holder_id, p."lineItemHolderId") AS "holderId", COALESCE(a.target_line_item_id, p."lineItemId") AS "lineItemId",
          li."costType", li.uom, p."lineItemHolderTitle" AS "holderTitle", li.matches AS "metadataMatches"
        FROM latest p
        LEFT JOIN analytics_po_line_aliases a ON a.company_id = p."procoreCompanyId" AND a.procore_project_id = p."procoreProjectId"
          AND a.source_line_item_id = p."lineItemId" AND (a.source_holder_id IS NULL OR a.source_holder_id = p."lineItemHolderId")
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS matches,
            CASE WHEN COUNT(*) = 1 THEN MAX(i."costCode") END AS "costCode",
            CASE WHEN COUNT(*) = 1 THEN MAX(i."costType") END AS "costType",
            CASE WHEN COUNT(*) = 1 THEN MAX(i.uom) END AS uom,
            CASE WHEN COUNT(*) = 1 THEN MAX(i.description) END AS description
          FROM (
            SELECT DISTINCT i."costCode", i."costType", i.uom, i.description
            FROM "PurchaseOrderLineItemContractDetail" i
            WHERE i."procoreCompanyId" = p."procoreCompanyId" AND i."procoreProjectId" = p."procoreProjectId"
              AND i."procoreId" = COALESCE(a.target_line_item_id, p."lineItemId")
              AND i."procorePurchaseOrderContractId" = CASE WHEN a.id IS NOT NULL THEN a.target_holder_id ELSE p."lineItemHolderId" END
              AND p."lineItemHolderType" = 'PurchaseOrderContract'
          ) i
        ) li ON true
        WHERE p.id > ${cursor} AND (${start}::timestamp IS NULL OR p.date >= ${start})
          AND (${end}::timestamp IS NULL OR p.date < ${end}) ORDER BY p.id LIMIT ${PAGE_SIZE}
      `;
      result.push(...rows);
      if (rows.length < PAGE_SIZE) return result;
      const next = rows[rows.length - 1].id;
      if (next <= cursor) throw new Error('Report pagination did not advance.');
      cursor = next;
    }
  }
  const [projects, timecards, logs] = await Promise.all([
    prisma.pmcProject.findMany({ where: { companyId }, select: { procoreProjectId: true, projectName: true, projectNumber: true, customer: true, status: true } }),
    read('Timecard'), read('Daily log'),
  ]);
  return buildProjectUsageReport(companyId, period, projects, [...timecards, ...logs]);
}

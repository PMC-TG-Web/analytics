import { prisma } from '@/lib/prisma';
import { loadEstimatingDashboardProjects } from '@/lib/estimatingDashboard';
import { buildCrewScorecard, crewWeekRange, type CrewProductionLog, type CrewTimecard } from './crewScorecard.ts';

const PAGE_SIZE = 500;

async function readPages<T extends { id: string }>(read: (cursor: string) => Promise<T[]>): Promise<T[]> {
  const rows: T[] = [];
  let cursor = '';
  while (true) {
    const page = await read(cursor);
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    const next = page[page.length - 1].id;
    if (next <= cursor) throw new Error('Crew scorecard pagination did not advance.');
    cursor = next;
  }
}

export async function loadCrewScorecard(companyId: string, week: string) {
  const { start, end } = crewWeekRange(week);
  const [timecards, logs, employees, projects, estimates] = await Promise.all([
    readPages(cursor => prisma.$queryRaw<CrewTimecard[]>`
      WITH latest AS (
        SELECT DISTINCT ON (t."procoreProjectId", COALESCE(t."procoreId", 'local:' || t.id)) t.*
        FROM "TimecardEntry" t WHERE t."procoreCompanyId" = ${companyId}
        ORDER BY t."procoreProjectId", COALESCE(t."procoreId", 'local:' || t.id),
          COALESCE(t."procoreUpdatedAt", t."updatedAt") DESC, t."updatedAt" DESC, t.id DESC
      )
      SELECT t.id, t."procoreId", t."procoreCompanyId" AS "companyId", t."procoreProjectId" AS "projectId",
        TO_CHAR(t.date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
        t."createdById" AS "creatorId", t."createdByName" AS "creatorName", t."createdByLogin" AS "creatorLogin",
        t."updatedAt" AS "syncedAt", t."procoreUpdatedAt" AS "sourceUpdatedAt", t."procoreDeletedAt" AS "deletedAt", t.status,
        COALESCE(t.hours, t."totalHoursWorked") AS hours, t."partyId" AS "workerId",
        COALESCE(NULLIF(BTRIM(t."partyName"), ''), t.party) AS "workerName", t.party,
        t."costCodeFullCode" AS "costCode", t."costCodeName"
      FROM latest t WHERE t.date >= ${start} AND t.date < ${end} AND t.id > ${cursor}
      ORDER BY t.id LIMIT ${PAGE_SIZE}
    `),
    readPages(cursor => prisma.$queryRaw<CrewProductionLog[]>`
      WITH latest AS (
        SELECT DISTINCT ON (p."procoreProjectId", COALESCE(p."procoreId", 'local:' || p.id)) p.*
        FROM "ProductivityLog" p WHERE p."procoreCompanyId" = ${companyId}
        ORDER BY p."procoreProjectId", COALESCE(p."procoreId", 'local:' || p.id),
          COALESCE(p."procoreUpdatedAt", p."updatedAt") DESC, p."updatedAt" DESC, p.id DESC
      )
      SELECT p.id, p."procoreId", p."procoreCompanyId" AS "companyId", p."procoreProjectId" AS "projectId",
        TO_CHAR(p.date, 'YYYY-MM-DD') AS date,
        p."createdById" AS "creatorId", p."createdByName" AS "creatorName", p."createdByLogin" AS "creatorLogin",
        p."updatedAt" AS "syncedAt", p."procoreUpdatedAt" AS "sourceUpdatedAt", p."procoreDeletedAt" AS "deletedAt", p.status,
        p."quantityUsed" AS quantity, COALESCE(a.target_line_item_id, p."lineItemId") AS "lineItemId",
        p."lineItemHolderTitle" AS "holderTitle", COALESCE(li.description, p."lineItemDescription") AS description,
        p."lineItemDescription" AS "logDescription",
        li."costCode", li."costType", li.uom, li.matches AS "metadataMatches"
      FROM latest p
      LEFT JOIN analytics_po_line_aliases a ON a.company_id = p."procoreCompanyId"
        AND a.procore_project_id = p."procoreProjectId" AND a.source_line_item_id = p."lineItemId"
        AND (a.source_holder_id IS NULL OR a.source_holder_id = p."lineItemHolderId")
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
      WHERE p.date >= ${start} AND p.date < ${end} AND p.id > ${cursor}
      ORDER BY p.id LIMIT ${PAGE_SIZE}
    `),
    prisma.employee.findMany({ where: { isActive: true }, select: {
      id: true, firstName: true, lastName: true, email: true, jobTitle: true, isActive: true,
    } }),
    prisma.pmcProject.findMany({ where: { companyId }, select: {
      procoreProjectId: true, bidBoardId: true, projectName: true, projectNumber: true,
    } }),
    loadEstimatingDashboardProjects(),
  ]);
  return buildCrewScorecard({ companyId, week, timecards, logs, employees, projects, estimates });
}

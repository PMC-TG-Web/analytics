import { prisma } from '@/lib/prisma';
import { loadWipPlanning, wipCompanyId } from '@/lib/loadWipPlanning';
import { wipLocalStorePath } from '@/lib/wipLocalStore';
import { attachSteelOrderMarks, buildSteelNeeds, type SteelActivity, type SteelEstimateLine, type SteelReport } from '@/lib/steelNeeds';

export async function loadSteelNeeds(): Promise<SteelReport> {
  const companyId = wipCompanyId();
  const projects = await loadWipPlanning(true);
  const sources = projects.filter(project => project.source.proposalId).map(project => ({
    bidBoardProjectId: project.source.bidBoardId, proposalId: project.source.proposalId,
  }));
  const lines: SteelEstimateLine[] = [];
  // Bounded pages avoid hosted Prisma response limits; never cap the final collection.
  let cursor: bigint | undefined;
  if (sources.length) while (true) {
    const page = await prisma.procoreEstimateLineItem.findMany({
      where: { companyId, OR: sources, ...(cursor === undefined ? {} : { id: { gt: cursor } }) },
      select: { id: true, companyId: true, bidBoardProjectId: true, proposalId: true, lineItemId: true, name: true, uom: true, quantity: true, payload: true, syncedAt: true },
      orderBy: { id: 'asc' }, take: 500,
    });
    lines.push(...page.map(line => ({ ...line, quantity: line.quantity === null ? null : Number(line.quantity), syncedAt: line.syncedAt.toISOString() })));
    if (page.length < 500) break;
    const next = page[page.length - 1].id;
    if (cursor !== undefined && next <= cursor) throw new Error('Estimate pagination did not advance.');
    cursor = next;
  }
  // Identity is company + external project + source record ID. Select the latest mirror
  // BEFORE excluding deleted records so older copies cannot make a job look started.
  const activity = await prisma.$queryRaw<SteelActivity[]>`
    WITH logs AS (
      SELECT DISTINCT ON ("procoreProjectId", COALESCE("procoreId", 'local:' || id))
        "procoreProjectId" AS project_id, date, "procoreDeletedAt", status, "lineItemHolderTitle"
      FROM "ProductivityLog" WHERE "procoreCompanyId" = ${companyId}
      ORDER BY "procoreProjectId", COALESCE("procoreId", 'local:' || id),
        COALESCE("procoreUpdatedAt", "updatedAt") DESC, "updatedAt" DESC, id DESC
    ), timecards AS (
      SELECT DISTINCT ON ("procoreProjectId", COALESCE("procoreId", 'local:' || id))
        "procoreProjectId" AS project_id, date, "procoreDeletedAt", status
      FROM "TimecardEntry" WHERE "procoreCompanyId" = ${companyId}
      ORDER BY "procoreProjectId", COALESCE("procoreId", 'local:' || id),
        COALESCE("procoreUpdatedAt", "updatedAt") DESC, "updatedAt" DESC, id DESC
    ), entries AS (
      SELECT project_id, date, 'log' AS source FROM logs
      WHERE "procoreDeletedAt" IS NULL AND LOWER(COALESCE(status, '')) NOT IN ('deleted', 'void', 'voided')
        AND COALESCE("lineItemHolderTitle", '') NOT ILIKE '%Billing File%'
      UNION ALL
      SELECT project_id, date AT TIME ZONE 'UTC', 'timecard' FROM timecards
      WHERE "procoreDeletedAt" IS NULL AND LOWER(COALESCE(status, '')) NOT IN ('deleted', 'void', 'voided')
    )
    SELECT project_id AS "projectId", COUNT(*) FILTER (WHERE source = 'log')::int AS "dailyLogs",
      COUNT(*) FILTER (WHERE source = 'timecard')::int AS timesheets, TO_CHAR(MIN(date), 'YYYY-MM-DD') AS "firstActivity"
    FROM entries WHERE project_id IS NOT NULL GROUP BY project_id
  `;
  const marks = await prisma.steelOrderMark.findMany({ where: { companyId, projectId: { in: projects.flatMap(project => project.projectId ? [project.projectId] : []) } },
    select: { projectId: true, itemKey: true, revision: true, orderedAt: true, quantity: true } });
  return { projects: attachSteelOrderMarks(buildSteelNeeds(companyId, projects, lines, activity), marks.map(mark => ({ ...mark,
    orderedAt: mark.orderedAt?.toISOString() || null, quantity: mark.quantity === null ? null : Number(mark.quantity),
  }))), loadedAt: new Date().toISOString(), localOnly: !!wipLocalStorePath() };
}

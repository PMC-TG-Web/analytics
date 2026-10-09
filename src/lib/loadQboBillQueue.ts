import type { DirectCostIssueSource } from './qboDirectCosts';
import { billProductSetupNeeded } from './qboBillProductSetup.js';
import { prisma } from './prisma';
import { directCostMonth } from './qboDirectCosts';
import { loadQboDirectCosts } from './loadQboDirectCosts';
import { loadQboCostCatalog } from './loadQboCostCatalog';
import { loadQboBillReview } from './loadQboBillReview';
import { hasQboBillBridge, requestQboBillBridge } from './qboBillBridge';
import { eligibleBillProjects } from './qboBillProjectPolicy';

export type BillQueueStatus = 'create' | 'update' | 'current' | 'blocked' | 'unavailable' | 'no_activity';
export type BillQueueRow = { projectId: string; projectName: string; projectNumber: string | null; status: BillQueueStatus; billNumber: string | null; gross: string | null; previousGross: number | null; laborHours: string | null; itemCount: number; lastPosted: string | null; reasons: string[]; issueSources?: DirectCostIssueSource[]; setupRequired?: boolean };
export async function loadQboBillQueue(companyId: string, month: string, page?: { after: string | null }) {
  const { start, end } = directCostMonth(month);
  const [allProjects, productivity, timecards, foodTotals] = await Promise.all([
    prisma.pmcProject.findMany({ where: { companyId }, select: { procoreProjectId: true, projectName: true, projectNumber: true }, orderBy: { projectName: 'asc' } }),
    // Include deleted sources so removal of the last log does not hide a posted bill.
    prisma.productivityLog.findMany({ where: { procoreCompanyId: companyId, date: { gte: start, lt: end } }, distinct: ['procoreProjectId'], select: { procoreProjectId: true } }),
    prisma.timecardEntry.findMany({ where: { procoreCompanyId: companyId, date: { gte: start, lt: end } }, distinct: ['procoreProjectId'], select: { procoreProjectId: true } }),
    prisma.qboBillFoodTotal.findMany({ where: { companyId, month }, select: { projectId: true } }),
  ]);
  const eligible = eligibleBillProjects(companyId, allProjects);
  // Canonical ID ordering keeps cursors stable when display names change.
  if (page) eligible.sort((a, b) => a.procoreProjectId.localeCompare(b.procoreProjectId));
  const afterIndex = page?.after ? eligible.findIndex(p => p.procoreProjectId === page.after) : -1;
  if (page?.after && afterIndex === -1) throw new Error('The project list changed. Refresh monthly bills.');
  const projects = page ? eligible.slice(afterIndex + 1, afterIndex + 5) : eligible;
  const nextCursor = page && afterIndex + 1 + projects.length < eligible.length ? projects.at(-1)!.procoreProjectId : null;
  const readTimeoutMs = page ? 8000 : undefined;
  const active = new Set([...productivity, ...timecards].map(p => p.procoreProjectId));
  for (const food of foodTotals) active.add(food.projectId);
  const pricingCatalog = await loadQboCostCatalog(companyId);
  // A single registry read avoids a round trip for every inactive project, while
  // retaining mapped projects whose final source entry was removed or moved.
  const catalog = hasQboBillBridge() ? await requestQboBillBridge<{ projectIds: string[] }>({ operation: 'catalog', companyId, projectId: '0', month }, readTimeoutMs).catch(() => null) : null;
  const mapped = catalog ? new Set(catalog.projectIds) : null;
  const rows: BillQueueRow[] = [];
  let next = 0;
  // Bound the monthly aggregation workload instead of opening a query per project at once.
  await Promise.all(Array.from({ length: Math.min(4, projects.length) }, async () => {
    while (next < projects.length) {
      const project = projects[next++];
      const row: BillQueueRow = { projectId: project.procoreProjectId, projectName: project.projectName, projectNumber: project.projectNumber, status: 'no_activity', billNumber: null, gross: null, previousGross: null, laborHours: null, itemCount: 0, lastPosted: null, reasons: [] };
      if (mapped && !active.has(row.projectId) && !mapped.has(row.projectId)) { rows.push(row); continue; }
      try {
        // Active projects already need a draft, so skip their redundant status read.
        let review = active.has(row.projectId) ? null : await loadQboBillReview(companyId, row.projectId, month, undefined, false, readTimeoutMs);
        if (active.has(row.projectId) || review?.billId || review?.action === 'reconcile') {
          const draft = await loadQboDirectCosts(companyId, row.projectId, month, pricingCatalog);
          review = await loadQboBillReview(companyId, row.projectId, month, draft, false, readTimeoutMs);
          Object.assign(row, { billNumber: review.billNumber, gross: review.grossTotal == null ? draft.total : review.grossTotal.toFixed(2), previousGross: review.previousGross, laborHours: draft.labor.combinedHours, itemCount: draft.lines.length, lastPosted: review.lastPosted });
          row.reasons = [...new Set([...draft.issues, ...review.issues])];
          row.issueSources = draft.issueSources;
          if (billProductSetupNeeded(draft, review)) { row.status = review.billId ? 'update' : 'create'; row.setupRequired = true; row.reasons = []; }
          else if (review.action === 'reconcile') { row.status = 'blocked'; row.reasons.push('Saved bill status requires reconciliation.'); }
          else if (row.reasons.length) row.status = 'blocked';
          else if (!draft.lines.length && !review.billId) row.status = 'no_activity';
          else if (!review.connected) { row.status = 'unavailable'; row.reasons.push('Project mapping or integration ledger unavailable; bill status is not verified.'); }
          else row.status = review.action === 'current' ? 'current' : review.billId ? 'update' : 'create';
        }
      } catch { row.status = 'blocked'; row.reasons = ['Unable to calculate this project. Open its review or refresh to retry.']; }
      rows.push(row);
    }
  }));
  const priority: Record<BillQueueStatus, number> = { update: 0, create: 1, blocked: 2, unavailable: 3, current: 4, no_activity: 5 };
  rows.sort((a, b) => priority[a.status] - priority[b.status] || a.projectName.localeCompare(b.projectName));
  return { companyId, month, generatedAt: new Date().toISOString(), rows, ...(page ? { nextCursor, totalProjects: eligible.length } : {}) };
}


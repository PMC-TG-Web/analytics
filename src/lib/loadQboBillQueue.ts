import type { DirectCostIssueSource } from './qboDirectCosts';
import { prisma } from './prisma';
import { directCostMonth } from './qboDirectCosts';
import { loadQboDirectCosts } from './loadQboDirectCosts';
import { loadQboCostCatalog } from './loadQboCostCatalog';
import { loadQboBillReview } from './loadQboBillReview';
import { hasQboBillBridge, requestQboBillBridge } from './qboBillBridge';

export type BillQueueStatus = 'create' | 'update' | 'current' | 'blocked' | 'unavailable' | 'no_activity';
export type BillQueueRow = { projectId: string; projectName: string; projectNumber: string | null; status: BillQueueStatus; billNumber: string | null; gross: string | null; previousGross: number | null; laborHours: string | null; itemCount: number; lastPosted: string | null; reasons: string[]; issueSources?: DirectCostIssueSource[] };
export async function loadQboBillQueue(companyId: string, month: string) {
  const { start, end } = directCostMonth(month);
  const [projects, productivity, timecards] = await Promise.all([
    prisma.pmcProject.findMany({ where: { companyId }, select: { procoreProjectId: true, projectName: true, projectNumber: true }, orderBy: { projectName: 'asc' } }),
    // Include deleted sources so removal of the last log does not hide a posted bill.
    prisma.productivityLog.findMany({ where: { procoreCompanyId: companyId, date: { gte: start, lt: end } }, distinct: ['procoreProjectId'], select: { procoreProjectId: true } }),
    prisma.timecardEntry.findMany({ where: { procoreCompanyId: companyId, date: { gte: start, lt: end } }, distinct: ['procoreProjectId'], select: { procoreProjectId: true } }),
  ]);
  const active = new Set([...productivity, ...timecards].map(p => p.procoreProjectId));
  const pricingCatalog = await loadQboCostCatalog(companyId);
  // A single registry read avoids a round trip for every inactive project, while
  // retaining mapped projects whose final source entry was removed or moved.
  const catalog = hasQboBillBridge() ? await requestQboBillBridge<{ projectIds: string[] }>({ operation: 'catalog', companyId, projectId: '0', month }).catch(() => null) : null;
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
        let review = await loadQboBillReview(companyId, row.projectId, month);
        if (active.has(row.projectId) || review.billId || review.action === 'reconcile') {
          const draft = await loadQboDirectCosts(companyId, row.projectId, month, pricingCatalog);
          review = await loadQboBillReview(companyId, row.projectId, month, draft);
          Object.assign(row, { billNumber: review.billNumber, gross: draft.total, previousGross: review.previousGross, laborHours: draft.labor.totalHours, itemCount: draft.lines.length, lastPosted: review.lastPosted });
          row.reasons = [...new Set([...draft.issues, ...review.issues])];
          row.issueSources = draft.issueSources;
          if (review.action === 'reconcile') { row.status = 'blocked'; row.reasons.push('Saved bill status requires reconciliation.'); }
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
  return { companyId, month, generatedAt: new Date().toISOString(), rows };
}


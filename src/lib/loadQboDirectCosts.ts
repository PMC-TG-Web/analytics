import { prisma } from './prisma';
import { aggregateDirectCosts, directCostMonth, DIRECT_COST_VENDOR } from './qboDirectCosts';
import { Prisma } from '@prisma/client';
import { aggregateDirectCostLabor } from './qboDirectCostLabor';
import { loadQboDirectCostLaborRates } from './loadQboDirectCostLaborRates';
import { loadQboCostCatalog } from './loadQboCostCatalog';
import { catalogSnapshotIssue, matchCatalogPrice, type BillCatalogSnapshot } from './qboCostCatalog';
import { loadEstimatingCostCodeCatalog } from './estimatingCostCodeCrosswalk';

export async function loadQboDirectCosts(companyId: string, projectId: string, month: string, catalogSnapshot?: BillCatalogSnapshot | null) {
  if (!/^\d+$/.test(companyId) || !/^\d+$/.test(projectId)) throw new Error('Company and Procore project IDs are required.');
  const { start, end } = directCostMonth(month);
  const project = await prisma.pmcProject.findUnique({ where: { companyId_procoreProjectId: { companyId, procoreProjectId: projectId } } });
  if (!project) throw new Error('Project not found in the selected company.');
  const catalog = catalogSnapshot === undefined ? await loadQboCostCatalog(companyId) : catalogSnapshot;
  const catalogIssue = catalogSnapshotIssue(catalog, companyId);
  // Procore log dates are persisted as midnight UTC date-only values, not instants in local time.
  const [logs, items, aliases, timecards, laborRates] = await Promise.all([
    prisma.productivityLog.findMany({ where: { procoreCompanyId: companyId, procoreProjectId: projectId, procoreDeletedAt: null, date: { gte: start, lt: end } },
      select: { id: true, procoreId: true, date: true, status: true, quantityUsed: true, lineItemId: true, lineItemDescription: true, lineItemHolderTitle: true, lineItemHolderNumber: true, lineItemHolderId: true, lineItemHolderType: true, updatedAt: true } }),
    prisma.purchaseOrderLineItemContractDetail.findMany({ where: { procoreCompanyId: companyId, procoreProjectId: projectId },
      select: { procoreId: true, description: true, uom: true, updatedAt: true, costCode: true, costType: true, customFields: true, procorePurchaseOrderContractId: true, purchaseOrderContract: { select: { number: true, title: true } } } }),
    prisma.$queryRaw<{ source_line_item_id: string; target_line_item_id: string }[]>`SELECT source_line_item_id, target_line_item_id FROM analytics_po_line_aliases WHERE company_id=${companyId} AND procore_project_id=${projectId}`,
    prisma.timecardEntry.findMany({ where: { procoreCompanyId: companyId, procoreProjectId: projectId, procoreDeletedAt: null, date: { gte: start, lt: end } }, select: { procoreId: true, date: true, hours: true, totalHoursWorked: true, costCodeFullCode: true, costCodeName: true, updatedAt: true } }),
    loadQboDirectCostLaborRates(companyId, projectId, catalog),
  ]);
  const crosswalk = loadEstimatingCostCodeCatalog();
  const pricedItems = items.map(item => {
    const raw = item.customFields as { cost_item?: { id?: string | number }; cost_item_id?: string | number } | null;
    const catalogItemId = raw?.cost_item?.id || raw?.cost_item_id;
    const price = catalogIssue ? { unitCost: null, evidence: null, issue: catalogIssue }
      : matchCatalogPrice({ ...item, catalogItemId: catalogItemId ? String(catalogItemId) : null }, catalog!.items, crosswalk);
    return { ...item, unitCost: price.unitCost, pricingIssue: price.issue, catalogPrice: price.evidence, updatedAt: catalog ? new Date(catalog.fetchedAt) : item.updatedAt };
  });
  const summary = aggregateDirectCosts(logs.map(log => ({ ...log, id: log.procoreId || log.id })), pricedItems, new Map(aliases.map(a => [a.source_line_item_id, a.target_line_item_id])));
  const labor = aggregateDirectCostLabor(timecards, laborRates.rates);
  const overlap = summary.lines.filter(l => /^(labor|l)$/i.test(l.costType || '') && labor.rows.some(t => t.costCode === l.costCode));
  const issues = [...summary.issues, ...labor.issues, ...(timecards.length && laborRates.issue ? [laborRates.issue] : []), ...overlap.map(l => `Labor cost code ${l.costCode} appears in both productivity logs and timecards; choose its source before posting.`)];
  return {
    schemaVersion: 3, scope: 'productivity_and_timecards', pricingSource: 'cost_catalog', catalogCheckedAt: catalog?.fetchedAt || null, generatedAt: new Date().toISOString(),
    companyId, projectId, projectName: project.projectName, projectNumber: project.projectNumber, month,
    vendorName: DIRECT_COST_VENDOR,
    ...summary,
    lines: [...summary.lines.map(l => ({ ...l, lineKey: l.procoreLineItemId, sourceType: 'productivity' as const })), ...labor.lines],
    issues, labor: { ...labor, proposalId: laborRates.proposalId }, materialTotal: summary.total,
    total: new Prisma.Decimal(summary.total).plus(labor.total).toFixed(2),
    timecardsNotIncluded: { count: labor.rows.filter(r => r.unitCost === null).reduce((n, r) => n + r.sourceLogs.length, 0), hours: Number(labor.unpricedHours) },
    sourceLogCount: logs.length,
    latestSourceUpdate: logs.length ? new Date(Math.max(...logs.map(l => l.updatedAt.getTime()))).toISOString() : null,
    notes: ['Uses approved productivity logs and non-deleted timecards, including timecards whose source has no approval status.', 'All unit costs and labor rates come from the current synchronized company Cost Catalog. Missing or ambiguous catalog matches block posting.', 'Negative category offsets are not included.'],
  };
}


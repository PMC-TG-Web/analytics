import { isHoursOnlyCost } from './qboDirectCostExclusions.js';
import { projectPrice } from './qboBillLineRules';
import { catalogSourceSignature } from './qboCatalogMapping';
import { prisma } from './prisma';
import { aggregateDirectCosts, directCostMonth, DIRECT_COST_VENDOR } from './qboDirectCosts';
import { Prisma } from '@prisma/client';
import { aggregateDirectCostLabor } from './qboDirectCostLabor';
import { loadQboDirectCostLaborRates } from './loadQboDirectCostLaborRates';
import { loadQboCostCatalog } from './loadQboCostCatalog';
import { catalogSnapshotIssue, type BillCatalogSnapshot } from './qboCostCatalog';
import { mappedCatalogPrice, duplicateCatalogSourceIds } from './qboCatalogMapping';
import { applyDirectCostCoding, isFoodCost } from './qboDirectCostCoding';
import { foodTotalLine } from './qboFoodTotal';
import { loadEstimatingCostCodeCatalog } from './estimatingCostCodeCrosswalk';

export async function loadQboDirectCosts(companyId: string, projectId: string, month: string, catalogSnapshot?: BillCatalogSnapshot | null) {
  if (!/^\d+$/.test(companyId) || !/^\d+$/.test(projectId)) throw new Error('Company and Procore project IDs are required.');
  const { start, end } = directCostMonth(month);
  const project = await prisma.pmcProject.findUnique({ where: { companyId_procoreProjectId: { companyId, procoreProjectId: projectId } } });
  if (!project) throw new Error('Project not found in the selected company.');
  const catalog = catalogSnapshot === undefined ? await loadQboCostCatalog(companyId) : catalogSnapshot;
  const catalogIssue = catalogSnapshotIssue(catalog, companyId);
  // Procore log dates are persisted as midnight UTC date-only values, not instants in local time.
  const [logs, items, aliases, timecards, laborRates, catalogMappings, foodLedger, lineRules] = await Promise.all([
    prisma.productivityLog.findMany({ where: { procoreCompanyId: companyId, procoreProjectId: projectId, procoreDeletedAt: null, date: { gte: start, lt: end } },
      select: { id: true, procoreId: true, date: true, status: true, quantityUsed: true, lineItemId: true, lineItemDescription: true, lineItemHolderTitle: true, lineItemHolderNumber: true, lineItemHolderId: true, lineItemHolderType: true, updatedAt: true } }),
    prisma.purchaseOrderLineItemContractDetail.findMany({ where: { procoreCompanyId: companyId, procoreProjectId: projectId },
      select: { procoreId: true, description: true, uom: true, updatedAt: true, costCode: true, costType: true, customFields: true, procorePurchaseOrderContractId: true, purchaseOrderContract: { select: { number: true, title: true } } } }),
    prisma.$queryRaw<{ source_line_item_id: string; target_line_item_id: string }[]>`SELECT source_line_item_id, target_line_item_id FROM analytics_po_line_aliases WHERE company_id=${companyId} AND procore_project_id=${projectId}`,
    prisma.timecardEntry.findMany({ where: { procoreCompanyId: companyId, procoreProjectId: projectId, procoreDeletedAt: null, date: { gte: start, lt: end } }, select: { procoreId: true, date: true, hours: true, totalHoursWorked: true, costCodeFullCode: true, costCodeName: true, updatedAt: true } }),
    loadQboDirectCostLaborRates(companyId, projectId, catalog),
    prisma.qboCostCatalogMapping.findMany({ where: { companyId, projectId } }),
    prisma.$transaction([
      prisma.qboBillFoodTotal.findUnique({ where: { companyId_projectId_month: { companyId, projectId, month } } }),
      prisma.qboBillFoodEntry.findMany({ where: { companyId, projectId, month }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    ], { isolationLevel: 'RepeatableRead' }),
    prisma.qboBillLineRule.findMany({ where: { companyId, projectId } }),
  ]);
  const rulesByKey = new Map(lineRules.map(rule => [rule.lineKey, rule]));
  const ignored = new Set(lineRules.filter(rule => rule.ignored).map(rule => rule.lineKey));
  const [savedFood, foodEntries] = foodLedger;
  const foodLedgerMismatch = !new Prisma.Decimal(savedFood?.amount || 0).eq(foodEntries.reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0)));
  const mappingByLine = new Map(catalogMappings.map(mapping => [mapping.lineItemId, mapping]));
  const crosswalk = loadEstimatingCostCodeCatalog();
  const aliasByLine = new Map(aliases.map(a => [a.source_line_item_id, a.target_line_item_id]));
  const activeLineIds = new Set(logs.filter(log => log.status?.toLowerCase() === 'approved' && Number(log.quantityUsed) > 0 && !/billing file/i.test(log.lineItemHolderTitle || '')).map(log => aliasByLine.get(log.lineItemId || '') || log.lineItemId));
  const codedItems = items.map(applyDirectCostCoding);
  const foodIds = new Set(codedItems.filter(item => item.procoreId && isFoodCost(item)).map(item => item.procoreId!));
  const knownItems = new Map(codedItems.map(item => [item.procoreId, item]));
  const isFoodLog = (log: typeof logs[number]) => {
    const id = aliasByLine.get(log.lineItemId || '') || log.lineItemId;
    return foodIds.has(id || '') || (!knownItems.has(id) && isFoodCost({ description: log.lineItemDescription }));
  };
  const foodLogCount = logs.filter(log => isFoodLog(log) && log.status?.toLowerCase() === 'approved' && !/billing file/i.test(log.lineItemHolderTitle || '')).length;
  const foodTotal = savedFood ? { amount: savedFood.amount.toFixed(2), revision: savedFood.revision, updatedBy: savedFood.updatedBy, updatedAt: savedFood.updatedAt.toISOString() } : null;
  const foodLine = foodTotalLine(companyId, projectId, month, foodTotal);
  const duplicateIds = duplicateCatalogSourceIds(codedItems.filter(item => activeLineIds.has(item.procoreId)));
  const pricedItems = codedItems.filter(item => !isFoodCost(item) && !ignored.has(item.procoreId || '')).map(item => {
    const raw = item.customFields as { cost_item?: { id?: string | number }; cost_item_id?: string | number } | null;
    const catalogItemId = raw?.cost_item?.id || raw?.cost_item_id;
    const override = projectPrice(item, rulesByKey.get(item.procoreId || ''));
    if (override) return { ...item, unitCost: override.unitCost ?? null, pricingIssue: override.issue ?? null, projectPrice: override.evidence ?? null, catalogPrice: null };
    const price = catalogIssue ? { unitCost: null, evidence: null, issue: catalogIssue }
      : mappedCatalogPrice({ ...item, catalogItemId: catalogItemId ? String(catalogItemId) : null }, catalog!.items, crosswalk, mappingByLine.get(item.procoreId || ''), !duplicateIds.has(item.procoreId || ''));
    return { ...item, projectPrice: null, unitCost: price.unitCost, pricingIssue: price.issue, catalogPrice: price.evidence, updatedAt: catalog ? new Date(catalog.fetchedAt) : item.updatedAt };
  });
  const summary = aggregateDirectCosts(logs.filter(log => !isFoodLog(log) && !ignored.has(aliasByLine.get(log.lineItemId || '') || log.lineItemId || '')).map(log => ({ ...log, id: log.procoreId || log.id })), pricedItems, new Map(aliases.map(a => [a.source_line_item_id, a.target_line_item_id])));
  const visibleItems = new Set([...summary.lines.map(line => line.procoreLineItemId), ...summary.issueSources.map(source => source.catalogLineItemId)]);
  const includedTimecards = timecards.filter(t => !isHoursOnlyCost(t.costCodeFullCode) && !ignored.has(`labor:${(t.costCodeFullCode || '').trim().replace(/\.L$/i, '') || '(unassigned)'}`));
  const labor = aggregateDirectCostLabor(includedTimecards, laborRates.rates);
  const overlap = summary.lines.filter(l => /^(labor|l)$/i.test(l.costType || '') && labor.rows.some(t => t.costCode === l.costCode));
  const issues = [...(foodLedgerMismatch ? ['Food ledger and saved total do not agree. Review the Food entries before posting.'] : []), ...summary.issues, ...labor.issues, ...(includedTimecards.length && laborRates.issue ? [laborRates.issue] : []), ...overlap.map(l => `Labor cost code ${l.costCode} appears in both productivity logs and timecards; choose its source before posting.`)];
  const ruleSources = [
    ...codedItems.filter(item => item.procoreId && (activeLineIds.has(item.procoreId) || rulesByKey.has(item.procoreId)) && !isFoodCost(item)).map(item => ({ lineKey:item.procoreId!, description:item.description || 'Unnamed item', costCode:item.costCode, costType:item.costType, uom:item.uom, allowPrice:true })),
    ...[...new Map(timecards.map(t => { const code=(t.costCodeFullCode || '').trim().replace(/\.L$/i, '') || '(unassigned)'; return [code,{lineKey:`labor:${code}`,description:t.costCodeName || code,costCode:code,costType:'Labor',uom:'hr',allowPrice:false}]; })).values()],
  ];
  for (const rule of lineRules) if (rule.lineKey.startsWith('labor:') && !ruleSources.some(source => source.lineKey === rule.lineKey)) ruleSources.push({lineKey:rule.lineKey,description:rule.description,costCode:rule.lineKey.slice(6),costType:'Labor',uom:'hr',allowPrice:false});
  const ruleItems = ruleSources.map(source => { const rule=rulesByKey.get(source.lineKey); return { ...source,sourceSignature:catalogSourceSignature(source),ignored:rule?.ignored || false,unitCost:rule?.unitCost?.toString() || null,reason:rule?.reason || '',revision:rule?.revision || 0 }; });
  return {
    ruleItems,
    schemaVersion: 3, scope: 'productivity_and_timecards', pricingSource: 'cost_catalog', catalogCheckedAt: catalog?.fetchedAt || null, generatedAt: new Date().toISOString(),
    companyId, projectId, projectName: project.projectName, projectNumber: project.projectNumber, month,
    vendorName: DIRECT_COST_VENDOR, food: { saved: foodTotal, logCount: foodLogCount, entries: foodEntries.map(entry => ({ id: entry.id, spentOn: entry.spentOn, note: entry.note, amount: entry.amount.toFixed(2), createdBy: entry.createdBy, createdAt: entry.createdAt.toISOString() })) },
    ...summary,
    catalogMappingItems: pricedItems.filter(item => item.procoreId && visibleItems.has(item.procoreId)).map(item => ({ lineItemId: item.procoreId!, description: item.description || 'Unnamed item', costCode: item.costCode, uom: item.uom, issue: item.pricingIssue, projectPrice: !!item.projectPrice, catalogName: item.catalogPrice?.name || null, manual: !!mappingByLine.get(item.procoreId!)?.catalogItemId })),
    lines: [...summary.lines.map(l => ({ ...l, lineKey: l.procoreLineItemId, sourceType: 'productivity' as const })), ...labor.lines, ...(foodLine ? [foodLine] : [])],
    issues, labor: { ...labor, proposalId: laborRates.proposalId }, materialTotal: new Prisma.Decimal(summary.total).plus(foodLine?.amount || '0').toFixed(2),
    total: new Prisma.Decimal(summary.total).plus(labor.total).plus(foodLine?.amount || '0').toFixed(2),
    timecardsNotIncluded: { count: labor.rows.filter(r => r.unitCost === null).reduce((n, r) => n + r.sourceLogs.length, 0), hours: Number(labor.unpricedHours) },
    sourceLogCount: logs.length,
    latestSourceUpdate: logs.length ? new Date(Math.max(...logs.map(l => l.updatedAt.getTime()))).toISOString() : null,
    notes: ['Uses approved productivity logs and non-deleted timecards, including timecards whose source has no approval status.', 'Food uses the entered monthly total once; Food daily-log quantities and PO prices are not multiplied. Other costs use the current synchronized company Cost Catalog. Missing or ambiguous catalog matches block posting.', 'Negative category offsets are not included.'],
  };
}


import { prisma } from './prisma';
import { loadQboCostCatalog } from './loadQboCostCatalog';
import { catalogSnapshotIssue } from './qboCostCatalog';
import { catalogMappingCandidates, catalogSourceSignature } from './qboCatalogMapping';

export async function loadQboCatalogMapping(companyId: string, projectId: string, lineItemId: string) {
  if (![companyId, projectId, lineItemId].every(id => /^\d+$/.test(id))) throw new Error('Choose a valid project and PO line.');
  const [items, catalog, mapping] = await Promise.all([
    prisma.purchaseOrderLineItemContractDetail.findMany({ where: { procoreCompanyId: companyId, procoreProjectId: projectId, procoreId: lineItemId }, take: 2,
      select: { description: true, costCode: true, costType: true, uom: true } }),
    loadQboCostCatalog(companyId),
    prisma.qboCostCatalogMapping.findUnique({ where: { companyId_projectId_lineItemId: { companyId, projectId, lineItemId } } }),
  ]);
  if (items.length !== 1) throw new Error('This PO line is unavailable or ambiguous in the selected project.');
  const issue = catalogSnapshotIssue(catalog, companyId);
  if (issue) throw new Error(issue);
  const source = items[0];
  return { source, sourceSignature: catalogSourceSignature(source), revision: mapping?.revision || 0, selectedItemId: mapping?.catalogItemId || null, candidates: catalogMappingCandidates(source, catalog!.items), checkedAt: catalog!.fetchedAt };
}

export async function saveQboCatalogMapping(input: { companyId: string; projectId: string; lineItemId: string; catalogItemId: string | null; sourceSignature: string; revision: number }, actor: string) {
  const current = await loadQboCatalogMapping(input.companyId, input.projectId, input.lineItemId);
  if (input.sourceSignature !== current.sourceSignature || input.revision !== current.revision) throw new Error('This item or its mapping changed. Reopen the catalog picker before saving.');
  if (input.catalogItemId !== null && !current.candidates.some(item => item.itemId === input.catalogItemId)) throw new Error('Choose a current catalog item with a matching unit and a positive price.');
  const key = { companyId: input.companyId, projectId: input.projectId, lineItemId: input.lineItemId };
  const data = { catalogItemId: input.catalogItemId, sourceSignature: current.sourceSignature, updatedBy: actor };
  if (!current.revision) {
    try { await prisma.qboCostCatalogMapping.create({ data: { ...key, ...data } }); }
    catch (e) { if ((e as { code?: string }).code === 'P2002') throw new Error('Another operator saved this mapping. Reopen the catalog picker.'); throw e; }
  } else {
    const result = await prisma.qboCostCatalogMapping.updateMany({ where: { ...key, revision: current.revision }, data: { ...data, revision: { increment: 1 } } });
    if (result.count !== 1) throw new Error('Another operator changed this mapping. Reopen the catalog picker.');
  }
  return { saved: true };
}

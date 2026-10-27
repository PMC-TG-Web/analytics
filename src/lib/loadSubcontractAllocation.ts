import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { estimateRecord, selectCommitmentEstimateBoard, selectPrimaryCommitmentEstimate } from '@/lib/procore/commitmentMakerEstimate';
import { estimateAllocationUnitCost, nullableNumber, type AllocationSource } from '@/lib/subcontractAllocation';
import { allocationGroupNames, resolveAllocationGroup } from '@/lib/subcontractAllocationGroups';
import { allocationBudgetCode, allocationCachedCoding } from '@/lib/subcontractAllocationCoding';

/** All reads use mirrors, joined only by company and explicit external identities. */
export async function loadSubcontractAllocation(companyId: string, projectId: string) {
  const [project, boards, linked] = await Promise.all([
    prisma.pmcProject.findUnique({ where: { companyId_procoreProjectId: { companyId, procoreProjectId: projectId } } }),
    prisma.pmcBidBoardProject.findMany({ where: { companyId, procoreProjectId: projectId }, select: { bidBoardId: true } }),
    prisma.procoreEstimateProposal.findMany({ where: { companyId, procoreProjectId: projectId }, select: { bidBoardProjectId: true } }),
  ]);
  if (!project) throw new Error('Project not found.');
  const bidBoardProjectId = selectCommitmentEstimateBoard([project.bidBoardId, ...boards.map(row => row.bidBoardId), ...linked.map(row => row.bidBoardProjectId)]);
  const proposals = await prisma.procoreEstimateProposal.findMany({ where: { companyId, bidBoardProjectId } });
  const primary = selectPrimaryCommitmentEstimate(proposals.map(row => estimateRecord(row.payload)));
  const proposalId = String(primary.id);
  const [lines, budgets, orders, estimateCache] = await Promise.all([
    prisma.procoreEstimateLineItem.findMany({ where: { companyId, bidBoardProjectId, proposalId }, orderBy: [{ groupId: 'asc' }, { lineItemId: 'asc' }] }),
    prisma.budgetLineItem.findMany({ where: { companyId, projectId, sourceMissingAt: null }, orderBy: { budgetLineItemId: 'asc' } }),
    prisma.purchaseOrderContract.findMany({ where: { procoreCompanyId: companyId, procoreProjectId: projectId, procoreDeletedAt: null },
      include: { lineItemContractDetails: { where: { procoreCompanyId: companyId, procoreProjectId: projectId }, orderBy: { id: 'asc' } } }, orderBy: { id: 'asc' } }),
    prisma.procoreCommitmentEstimateCache.findUnique({ where: { companyId_projectId: { companyId, projectId } }, select: { snapshot: true } }),
  ]);
  if (!lines.length) throw new Error('The primary estimate has no synchronized lines. Sync the estimate before preparing an allocation.');
  const groupNames = allocationGroupNames(estimateCache?.snapshot, bidBoardProjectId, proposalId);
  let missingGroupNames = false;
  const source: AllocationSource = {
    projectId, projectName: project.projectName, bidBoardProjectId, proposalId,
    proposalName: String(primary.name || 'Primary estimate'),
    syncedAt: new Date(Math.min(...lines.map(line => line.syncedAt.getTime()))).toISOString(),
    lines: lines.map(line => {
      const payload = estimateRecord(line.payload);
      const item = estimateRecord(payload.cost_item);
      const quantity = nullableNumber(line.quantity);
      const itemCost = nullableNumber(line.itemCost);
      const laborCost = nullableNumber(line.laborCost);
      const group = resolveAllocationGroup(line, groupNames);
      missingGroupNames ||= group.missingName;
      const budgetCode = allocationBudgetCode(payload) || allocationCachedCoding(estimateCache?.snapshot, bidBoardProjectId, proposalId, line.lineItemId, String(item.id || line.costItemId || ''));
      return { id: line.lineItemId, groupId: group.groupId, groupName: group.groupName,
        name: line.name || String(item.name || line.lineItemId), costCode: line.costCode || budgetCode, budgetCode, uom: line.uom || String(item.unit || ''),
        quantity, unitCost: estimateAllocationUnitCost(quantity, itemCost, laborCost),
        unitRevenue: estimateAllocationUnitCost(quantity, nullableNumber(line.itemSales), nullableNumber(line.laborSales)) };
    }),
    budgets: budgets.map(line => ({ id: line.budgetLineItemId, name: line.name || line.costCodeDescription || line.budgetLineItemId,
      costCode: [line.costCode, line.lineItemType].filter(Boolean).join(' · '), amount: nullableNumber(line.amount ?? line.originalBudgetAmount) })),
    poLines: orders.flatMap(po => po.procoreId ? po.lineItemContractDetails.filter(line => line.procoreId && line.procorePurchaseOrderContractId === po.procoreId).map(line => ({
      id: line.id, procoreLineId: line.procoreId!, poId: po.procoreId!, poName: [po.number, po.title, po.vendorName, po.status].filter(Boolean).join(' · '),
      name: line.description || line.procoreId!, costCode: line.costCode || '', uom: line.uom || '',
      quantity: nullableNumber(line.quantity), unitCost: nullableNumber(line.unitCost),
    })) : []),
  };
  // Sync timestamps alone do not invalidate an unchanged draft.
  const fingerprint = createHash('sha256').update(JSON.stringify({ ...source, syncedAt: undefined })).digest('hex');
  return { source, fingerprint, missingGroupNames };
}

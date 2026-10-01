import { loadQboCostCatalog } from './loadQboCostCatalog';
import { catalogSnapshotIssue, type BillCatalogSnapshot } from './qboCostCatalog';
import type { LaborRate } from './qboDirectCostLabor';

export async function loadQboDirectCostLaborRates(companyId: string, projectId: string, snapshot?: BillCatalogSnapshot | null) {
  if (!/^\d+$/.test(companyId) || !/^\d+$/.test(projectId)) throw new Error('Company and Procore project IDs are required.');
  const catalog = snapshot === undefined ? await loadQboCostCatalog(companyId) : snapshot;
  const issue = catalogSnapshotIssue(catalog, companyId);
  const rates: LaborRate[] = issue ? [] : catalog!.items.filter(item => item.type === 'LABOR' && item.uom === 'hr').map(item => ({
    costCode: item.costCode, rate: item.laborRate, lineItemId: item.itemId, catalogItemId: item.itemId,
    catalogId: item.catalogId, updatedAt: catalog!.fetchedAt,
  }));
  return { rates, issue, proposalId: null };
}

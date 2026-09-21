import { prisma } from './prisma';
import { BILL_CATALOG_DATASET, BILL_CATALOG_PROJECT, type BillCatalogSnapshot } from './qboCostCatalog';

export async function loadQboCostCatalog(companyId: string): Promise<BillCatalogSnapshot | null> {
  const state = await prisma.procoreSyncProjectState.findUnique({ where: {
    companyId_projectId_dataset: { companyId, projectId: BILL_CATALOG_PROJECT, dataset: BILL_CATALOG_DATASET },
  }, select: { lastResult: true } });
  const value = state?.lastResult as unknown as BillCatalogSnapshot | null;
  return value?.version === 1 && value.companyId === companyId && Array.isArray(value.items) ? value : null;
}

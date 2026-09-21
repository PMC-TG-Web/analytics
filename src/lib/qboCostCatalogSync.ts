import { createRequire } from 'node:module';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { getClientCredentialsToken, makeRequest } from './procore';
import { loadEstimatingCostCodeCatalog } from './estimatingCostCodeCrosswalk';
import { BILL_CATALOG_DATASET, BILL_CATALOG_PROJECT, normalizeCatalogPrice, type BillCatalogSnapshot, type CatalogPrice } from './qboCostCatalog';

const configRequire = createRequire(import.meta.url);
const settings = configRequire('../../config/qboCostCatalog.json') as Record<string, { catalogId: string; name: string }>;
function rows(value: unknown): Record<string, unknown>[] {
  const array = Array.isArray(value) ? value : (value as { data?: unknown })?.data;
  if (!Array.isArray(array)) throw new Error('Procore returned an incomplete Cost Catalog response.');
  return array;
}
export async function readQboCostCatalog(companyId: string, read: (endpoint: string) => Promise<unknown>, now = new Date()): Promise<BillCatalogSnapshot> {
  const config = settings[companyId];
  if (!config || !/^\d+$/.test(config.catalogId)) throw new Error('A company Cost Catalog must be configured for direct costs.');
  const base = `/rest/v2.0/companies/${companyId}/estimating/catalogs`;
  const roots = rows(await read(`${base}?page=1&per_page=100`));
  if (!roots.some(root => String(root.id) === config.catalogId && root.custom === true)) throw new Error('The configured company Cost Catalog is unavailable.');
  const crosswalk = loadEstimatingCostCodeCatalog();
  const items: CatalogPrice[] = [], seen = new Set<string>();
  for (let page = 1; page <= 20; page++) {
    // This endpoint includes descendants. Procore caps the page size at 100.
    const batch = rows(await read(`${base}/${config.catalogId}/items?page=${page}&per_page=100`));
    for (const value of batch) {
      const id = String(value.id || '');
      if (!/^\d+$/.test(id) || seen.has(id)) throw new Error('Procore returned repeated or incomplete Cost Catalog items.');
      seen.add(id);
      const item = normalizeCatalogPrice(value, crosswalk.get(id)?.costCode);
      if (item) items.push(item);
    }
    if (batch.length < 100) {
      if (!items.length) throw new Error('The company Cost Catalog contains no cost-coded items.');
      return { version: 1, companyId, fetchedAt: now.toISOString(), items: items.sort((a, b) => a.itemId.localeCompare(b.itemId)) };
    }
  }
  throw new Error('Cost Catalog refresh exceeded the supported size; no partial prices were saved.');
}

// Called only inside the existing company worker lease and sync-secret context.
export async function refreshQboCostCatalog(companyId: string) {
  const where = { companyId_projectId_dataset: { companyId, projectId: BILL_CATALOG_PROJECT, dataset: BILL_CATALOG_DATASET } };
  const state = await prisma.procoreSyncProjectState.findUnique({ where });
  const now = new Date();
  if (state && state.nextRunAt > now) return { synced: false };
  const attempt = { lastAttemptAt: now, nextRunAt: new Date(now.getTime() + 5 * 60_000) };
  await prisma.procoreSyncProjectState.upsert({ where, create: { companyId, projectId: BILL_CATALOG_PROJECT, dataset: BILL_CATALOG_DATASET, ...attempt }, update: attempt });
  try {
    const token = await getClientCredentialsToken();
    const snapshot = await readQboCostCatalog(companyId, endpoint => makeRequest(endpoint, token, {}, companyId));
    await prisma.procoreSyncProjectState.update({ where, data: { lastSuccessAt: new Date(snapshot.fetchedAt), lastError: null, failureCount: 0, lastResult: snapshot as unknown as Prisma.InputJsonValue } });
    return { synced: true, checkedAt: snapshot.fetchedAt };
  } catch {
    await prisma.procoreSyncProjectState.update({ where, data: { lastError: 'Cost Catalog refresh failed; the last complete snapshot was preserved.', failureCount: { increment: 1 } } });
    throw new Error('Cost Catalog refresh failed. Automatic checks will retry.');
  }
}

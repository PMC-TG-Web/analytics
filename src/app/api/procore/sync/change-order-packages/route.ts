import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  makeRequest,
  procoreConfig,
  getClientCredentialsToken,
  withProcoreLiveApiBypassForSyncSecret,
} from '@/lib/procore';
import { getCanonicalProjectIdsForCompany } from '@/lib/procoreCanonicalProjectIds';
import {
  ensureChangeOrderPackagesTable,
  reconcileChangeOrderPackageLines,
  upsertChangeOrderPackage,
  upsertChangeOrderPackageLine,
} from '@/lib/procoreChangeOrderPackages';
import {
  ensurePotentialChangeOrderTables,
  reconcilePotentialChangeOrderLines,
  reconcilePotentialChangeOrders,
  upsertPotentialChangeOrder,
  upsertPotentialChangeOrderLine,
} from '@/lib/procorePotentialChangeOrders';
import { procoreApiErrorIsNotFound } from '@/lib/procoreSyncResponse';

export const dynamic = 'force-dynamic';

type JsonObject = Record<string, unknown>;

type PrimeContractRecord = {
  id?: number | string;
  title?: string;
  number?: string;
  status?: string;
  contract_date?: string;
  signed_contract_received_date?: string;
  execution_date?: string;
  updated_at?: string;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function readText(value: unknown): string {
  return String(value ?? '').trim();
}

function parseCsvIds(value: unknown): string[] {
  return String(value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function isAccessSkippedError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('error 403') ||
    lower.includes('forbidden') ||
    lower.includes('error 404') ||
    lower.includes('not found')
  );
}

function unwrapArray(response: unknown): JsonObject[] {
  if (Array.isArray(response)) {
    return response.filter(
      (v): v is JsonObject => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
    );
  }
  if (response && typeof response === 'object') {
    const r = response as Record<string, unknown>;
    for (const key of ['data', 'potential_change_orders', 'line_items', 'line_item_contract_details']) {
      if (!Array.isArray(r[key])) continue;
      return (r[key] as unknown[]).filter(
        (v): v is JsonObject => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
      );
    }
  }
  return [];
}

function toUnixScore(value: unknown): number {
  const text = readText(value);
  if (!text) return 0;
  const ts = Date.parse(text);
  return Number.isNaN(ts) ? 0 : ts;
}

function choosePrimeContract(records: PrimeContractRecord[]): PrimeContractRecord | null {
  if (!records.length) return null;
  return [...records].sort((a, b) => {
    const score = (r: PrimeContractRecord) =>
      Math.max(
        toUnixScore(r.signed_contract_received_date),
        toUnixScore(r.contract_date),
        toUnixScore(r.execution_date),
        toUnixScore(r.updated_at)
      );
    return score(b) - score(a);
  })[0];
}

// ─── DB helpers ─────────────────────────────────────────────────────────────

// ─── Procore fetchers ────────────────────────────────────────────────────────

async function fetchPrimeContracts(
  accessToken: string,
  companyId: string,
  projectId: string
): Promise<PrimeContractRecord[]> {
  const qs = new URLSearchParams({ project_id: projectId, page: '1', per_page: '100' });
  const data = await makeRequest(
    `/rest/v1.0/prime_contracts?${qs.toString()}`,
    accessToken,
    { method: 'GET', cache: 'no-store' },
    companyId,
    [404]
  );
  return Array.isArray(data) ? (data as PrimeContractRecord[]) : [];
}

async function fetchChangeOrderPackagesPage(
  accessToken: string,
  companyId: string,
  projectId: string,
  contractId: string,
  page: number,
  perPage: number
): Promise<JsonObject[]> {
  const qs = new URLSearchParams({
    project_id: projectId,
    contract_id: contractId,
    page: String(page),
    per_page: String(perPage),
  });
  const data = await makeRequest(
    `/rest/v1.0/change_order_packages?${qs.toString()}`,
    accessToken,
    { method: 'GET', cache: 'no-store' },
    companyId,
    [404]
  );
  return unwrapArray(data);
}

async function fetchChangeOrderPackage(
  accessToken: string,
  companyId: string,
  projectId: string,
  contractId: string,
  packageId: string
): Promise<JsonObject> {
  const qs = new URLSearchParams({ project_id: projectId, contract_id: contractId });
  const data = await makeRequest(
    `/rest/v1.0/change_order_packages/${encodeURIComponent(packageId)}?${qs.toString()}`,
    accessToken,
    { method: 'GET', cache: 'no-store' },
    companyId,
    [404]
  );
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as JsonObject) : {};
}

async function fetchPotentialChangeOrdersPage(
  accessToken: string,
  companyId: string,
  projectId: string,
  page: number,
  perPage: number
): Promise<JsonObject[]> {
  const qs = new URLSearchParams({
    project_id: projectId,
    page: String(page),
    per_page: String(perPage),
  });
  const data = await makeRequest(
    `/rest/v1.0/potential_change_orders?${qs.toString()}`,
    accessToken,
    { method: 'GET', cache: 'no-store' },
    companyId,
    [404]
  );
  return unwrapArray(data);
}

async function fetchPotentialChangeOrderLines(
  accessToken: string,
  companyId: string,
  projectId: string,
  changeOrderId: string,
  perPage: number
): Promise<JsonObject[]> {
  const endpointNames = ['line_items', 'line_item_contract_details'];
  for (const endpointName of endpointNames) {
    const records: JsonObject[] = [];
    for (let page = 1; page <= 50; page += 1) {
      const qs = new URLSearchParams({
        project_id: projectId,
        page: String(page),
        per_page: String(perPage),
      });
      const data = await makeRequest(
        `/rest/v1.0/potential_change_orders/${encodeURIComponent(changeOrderId)}/${endpointName}?${qs.toString()}`,
        accessToken,
        { method: 'GET', cache: 'no-store' },
        companyId,
        [404]
      );
      const pageRecords = unwrapArray(data);
      if (pageRecords.length === 0) break;
      records.push(...pageRecords);
      if (pageRecords.length < perPage) break;
    }
    if (records.length > 0) return records;
  }
  return [];
}

// ─── Main handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  return withProcoreLiveApiBypassForSyncSecret(request, async () => {
    try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const cookieStore = await cookies();

    const userAccessToken = readText(
      body.accessToken || cookieStore.get('procore_access_token')?.value
    );
    const companyId = readText(
      body.companyId || cookieStore.get('procore_company_id')?.value || procoreConfig.companyId
    );
    const limitProjects = Math.min(
      10000,
      Math.max(1, Number.parseInt(String(body.limitProjects || '100'), 10) || 100)
    );
    const perPage = Math.min(200, Math.max(1, Number.parseInt(String(body.perPage || '100'), 10) || 100));

    let accessToken: string;
    if (userAccessToken) {
      accessToken = userAccessToken;
    } else {
      try {
        accessToken = await getClientCredentialsToken();
      } catch {
        return NextResponse.json(
          { success: false, error: 'Missing access token. Please authenticate via OAuth first.' },
          { status: 401 }
        );
      }
    }


    if (!companyId) {
      return NextResponse.json(
        { success: false, error: 'Missing companyId.' },
        { status: 400 }
      );
    }

    await Promise.all([
      ensureChangeOrderPackagesTable(),
      ensurePotentialChangeOrderTables(),
    ]);

    const explicitProjectIds = Array.isArray(body.projectIds)
      ? body.projectIds.map((v) => readText(v)).filter((v) => v.length > 0)
      : parseCsvIds(body.projectIds);

    const projectIds = explicitProjectIds.length > 0
      ? explicitProjectIds
      : await getCanonicalProjectIdsForCompany(companyId, limitProjects);
    if (projectIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No project IDs found in canonical Procore project staging. Run All Projects Sync first.',
        },
        { status: 400 }
      );
    }

    let projectsScanned = 0;
    let projectsSkippedNoPrimeContract = 0;
    let projectsSkippedAccess = 0;
    let projectsWithPackages = 0;
    let totalPackagesFetched = 0;
    let totalPackagesUpserted = 0;
    let totalPackageLinesFetched = 0;
    let totalPackageLinesUpserted = 0;
    let projectsWithPotentialChangeOrders = 0;
    let totalPotentialChangeOrdersFetched = 0;
    let totalPotentialChangeOrdersUpserted = 0;
    let totalPotentialChangeOrderLinesFetched = 0;
    let totalPotentialChangeOrderLinesUpserted = 0;
    const activeProjects: Array<{
      projectId: string;
      contractId: string;
      packageCount: number;
      upsertedCount: number;
      lineItemCount: number;
      status: string;
    }> = [];
    const warnings: string[] = [];
    const errors: string[] = [];

    for (const projectId of projectIds) {
      projectsScanned += 1;

      // Resolve prime contract
      let contractId: string;
      try {
        const contracts = await fetchPrimeContracts(accessToken, companyId, projectId);
        const chosen = choosePrimeContract(contracts);
        contractId = readText(chosen?.id);
        if (!contractId) {
          projectsSkippedNoPrimeContract += 1;
          continue;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isAccessSkippedError(message)) {
          projectsSkippedAccess += 1;
          if (warnings.length < 25) {
            warnings.push(`project:${projectId} prime_contracts skipped: ${message}`);
          }
        } else {
          errors.push(`project:${projectId} prime_contracts => ${message}`);
        }
        continue;
      }

      // Potential Change Orders are synced separately from Prime Contract
      // Change Orders. The dashboard uses the PCO IDs carried by PCCO lines
      // to prevent the same approved change from being counted twice.
      let potentialPage = 1;
      let potentialFetchComplete = true;
      const projectPotentialIds: string[] = [];
      let projectPotentialFetched = 0;
      let projectPotentialUpserted = 0;
      let projectPotentialLinesFetched = 0;
      let projectPotentialLinesUpserted = 0;
      while (true) {
        let potentialItems: JsonObject[];
        try {
          potentialItems = await fetchPotentialChangeOrdersPage(
            accessToken,
            companyId,
            projectId,
            potentialPage,
            perPage
          );
        } catch (err) {
          potentialFetchComplete = false;
          const message = err instanceof Error ? err.message : String(err);
          if (isAccessSkippedError(message)) {
            if (warnings.length < 25) warnings.push(`project:${projectId} potential_change_orders skipped: ${message}`);
          } else {
            errors.push(`project:${projectId} potential_change_orders => ${message}`);
          }
          break;
        }
        if (potentialItems.length === 0) break;
        projectPotentialFetched += potentialItems.length;

        for (const potentialItem of potentialItems) {
          const changeOrderId = readText(potentialItem.id);
          if (!changeOrderId) continue;
          try {
            const persistedId = await upsertPotentialChangeOrder({
              companyId,
              projectId,
              record: potentialItem,
            });
            if (!persistedId) continue;
            projectPotentialIds.push(persistedId);
            projectPotentialUpserted += 1;

            let potentialLines: JsonObject[];
            try {
              potentialLines = await fetchPotentialChangeOrderLines(
                accessToken,
                companyId,
                projectId,
                changeOrderId,
                perPage
              );
            } catch (err) {
              if (!procoreApiErrorIsNotFound(err)) throw err;
              const message = err instanceof Error ? err.message : String(err);
              if (warnings.length < 25) {
                warnings.push(`project:${projectId} potential:${changeOrderId} lines skipped: ${message}`);
              }
              // Procore can retain a PCO in the project list after its child
              // line-item resource is removed or becomes unavailable. Keep the
              // valid parent and do not let that stale child fail the project.
              continue;
            }
            projectPotentialLinesFetched += potentialLines.length;
            const persistedLineIds: string[] = [];
            let linePersistenceFailed = false;
            for (let index = 0; index < potentialLines.length; index += 1) {
              try {
                const lineId = await upsertPotentialChangeOrderLine({
                  companyId,
                  projectId,
                  changeOrderId,
                  changeOrderStatus: readText(potentialItem.status),
                  record: potentialLines[index],
                  index,
                });
                persistedLineIds.push(lineId);
                projectPotentialLinesUpserted += 1;
              } catch (err) {
                linePersistenceFailed = true;
                const message = err instanceof Error ? err.message : String(err);
                errors.push(`project:${projectId} potential:${changeOrderId} line:${index + 1} => ${message}`);
              }
            }
            if (!linePersistenceFailed) {
              await reconcilePotentialChangeOrderLines({
                companyId,
                projectId,
                changeOrderId,
                lineItemIds: persistedLineIds,
              });
            }
          } catch (err) {
            potentialFetchComplete = false;
            const message = err instanceof Error ? err.message : String(err);
            errors.push(`project:${projectId} potential:${changeOrderId} => ${message}`);
          }
        }

        if (potentialItems.length < perPage) break;
        potentialPage += 1;
        if (potentialPage > 50) {
          potentialFetchComplete = false;
          break;
        }
      }
      if (potentialFetchComplete) {
        await reconcilePotentialChangeOrders({
          companyId,
          projectId,
          changeOrderIds: projectPotentialIds,
        });
      }
      totalPotentialChangeOrdersFetched += projectPotentialFetched;
      totalPotentialChangeOrdersUpserted += projectPotentialUpserted;
      totalPotentialChangeOrderLinesFetched += projectPotentialLinesFetched;
      totalPotentialChangeOrderLinesUpserted += projectPotentialLinesUpserted;
      if (projectPotentialFetched > 0) projectsWithPotentialChangeOrders += 1;

      // Fetch change order packages (all pages)
      let page = 1;
      let projectFetched = 0;
      let projectUpserted = 0;
      let projectLineItemsFetched = 0;
      let projectLineItemsUpserted = 0;
      let hadError = false;

      while (true) {
        let items: JsonObject[];
        try {
          items = await fetchChangeOrderPackagesPage(
            accessToken,
            companyId,
            projectId,
            contractId,
            page,
            perPage
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (isAccessSkippedError(message)) {
            projectsSkippedAccess += 1;
            if (warnings.length < 25) {
              warnings.push(`project:${projectId} change_order_packages skipped: ${message}`);
            }
          } else {
            errors.push(`project:${projectId} change_order_packages => ${message}`);
          }
          hadError = true;
          break;
        }

        if (items.length === 0) break;
        projectFetched += items.length;

        for (const item of items) {
          try {
            const packageId = readText(item.id);
            if (!packageId) continue;
            let packageRecord = item;
            let packageLineItemsAuthoritative = Array.isArray(item.line_items);
            try {
              const showRecord = await fetchChangeOrderPackage(
                accessToken,
                companyId,
                projectId,
                contractId,
                packageId
              );
              if (Object.keys(showRecord).length > 0) {
                packageRecord = showRecord;
                packageLineItemsAuthoritative = Array.isArray(showRecord.line_items);
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              if (warnings.length < 25) {
                warnings.push(`project:${projectId} package:${packageId} show skipped: ${message}`);
              }
            }

            await upsertChangeOrderPackage({
              companyId,
              projectId,
              contractId,
              record: packageRecord,
            });

            const lineItems = unwrapArray(packageRecord.line_items);
            projectLineItemsFetched += lineItems.length;
            const persistedLineItemIds: string[] = [];
            let linePersistenceFailed = false;
            for (let index = 0; index < lineItems.length; index += 1) {
              try {
                const lineItemId = await upsertChangeOrderPackageLine({
                  companyId,
                  projectId,
                  contractId,
                  packageId,
                  packageStatus: readText(packageRecord.status),
                  record: lineItems[index],
                  index,
                });
                persistedLineItemIds.push(lineItemId);
                projectLineItemsUpserted += 1;
              } catch (err) {
                linePersistenceFailed = true;
                const message = err instanceof Error ? err.message : String(err);
                errors.push(`project:${projectId} package:${packageId} line:${index + 1} => ${message}`);
              }
            }
            if (packageLineItemsAuthoritative && !linePersistenceFailed) {
              await reconcileChangeOrderPackageLines({
                companyId,
                projectId,
                packageId,
                lineItemIds: persistedLineItemIds,
              });
            }
            projectUpserted += 1;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const id = readText(item.id) || 'unknown';
            errors.push(`project:${projectId} package:${id} => ${message}`);
          }
        }

        if (items.length < perPage) break;
        page += 1;
        if (page > 50) break; // safety cap
      }

      if (!hadError || projectFetched > 0) {
        totalPackagesFetched += projectFetched;
        totalPackagesUpserted += projectUpserted;
        totalPackageLinesFetched += projectLineItemsFetched;
        totalPackageLinesUpserted += projectLineItemsUpserted;

        if (projectFetched > 0) {
          projectsWithPackages += 1;
          activeProjects.push({
            projectId,
            contractId,
            packageCount: projectFetched,
            upsertedCount: projectUpserted,
            lineItemCount: projectLineItemsUpserted,
            status: 'synced',
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      companyId,
      projectsScanned,
      projectsWithPackages,
      projectsSkippedNoPrimeContract,
      projectsSkippedAccess,
      totalPackagesFetched,
      totalPackagesUpserted,
      totalPackageLinesFetched,
      totalPackageLinesUpserted,
      projectsWithPotentialChangeOrders,
      totalPotentialChangeOrdersFetched,
      totalPotentialChangeOrdersUpserted,
      totalPotentialChangeOrderLinesFetched,
      totalPotentialChangeOrderLinesUpserted,
      errors: errors.slice(0, 50),
      warnings: warnings.slice(0, 25),
      activeProjects: activeProjects.slice(0, 100),
    });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json(
        { success: false, error: 'Failed to sync change order packages', details: message },
        { status: 500 }
      );
    }
  });
}

export async function GET() {
  return NextResponse.json(
    { success: false, error: 'Change order package sync requires POST.' },
    { status: 405, headers: { Allow: 'POST' } }
  );
}

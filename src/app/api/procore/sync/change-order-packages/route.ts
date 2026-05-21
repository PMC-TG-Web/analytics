import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { makeRequest, procoreConfig, getClientCredentialsToken } from '@/lib/procore';
import { getCanonicalProjectIdsForCompany } from '@/lib/procoreCanonicalProjectIds';
import {
  ensureChangeOrderPackagesTable,
  upsertChangeOrderPackage,
} from '@/lib/procoreChangeOrderPackages';

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
    if (Array.isArray(r.data)) {
      return r.data.filter(
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

// ─── Main handler ────────────────────────────────────────────────────────────

export async function POST(request: Request) {
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

    await ensureChangeOrderPackagesTable();

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
    const activeProjects: Array<{
      projectId: string;
      contractId: string;
      packageCount: number;
      upsertedCount: number;
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

      // Fetch change order packages (all pages)
      let page = 1;
      let projectFetched = 0;
      let projectUpserted = 0;
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
            await upsertChangeOrderPackage({
              companyId,
              projectId,
              contractId,
              record: item,
            });
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

        if (projectFetched > 0) {
          projectsWithPackages += 1;
          activeProjects.push({
            projectId,
            contractId,
            packageCount: projectFetched,
            upsertedCount: projectUpserted,
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
}

export async function GET() {
  return NextResponse.json(
    { success: false, error: 'Change order package sync requires POST.' },
    { status: 405, headers: { Allow: 'POST' } }
  );
}

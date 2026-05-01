import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig, getClientCredentialsToken } from "@/lib/procore";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type ProcoreProject = Record<string, unknown>;
type PrimeContractRecord = Record<string, unknown>;

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return "";
}

function toNullableDate(value: unknown): Date | null {
  const text = readText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeContractDate(record: PrimeContractRecord): Date | null {
  return (
    toNullableDate(record.signed_contract_received_date) ||
    toNullableDate(record.contract_date) ||
    toNullableDate(record.execution_date)
  );
}

function isNotFoundError(err: unknown): boolean {
  const status = Number((err as { status?: number })?.status || 0);
  if (status === 404) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /(?:^|\D)404(?:\D|$)/.test(msg);
}

async function ensurePrimeContractsLiveTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS procore_prime_contracts_live (
      prime_contract_id TEXT PRIMARY KEY,
      company_id TEXT,
      project_id TEXT,
      project_procore_id TEXT,
      number TEXT,
      title TEXT,
      status TEXT,
      contract_date TIMESTAMPTZ,
      signed_contract_received_date TIMESTAMPTZ,
      execution_date TIMESTAMPTZ,
      contract_start_date TIMESTAMPTZ,
      payload JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS procore_prime_contracts_live_project_id_idx
      ON procore_prime_contracts_live (project_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS procore_prime_contracts_live_project_procore_id_idx
      ON procore_prime_contracts_live (project_procore_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS procore_prime_contracts_live_synced_at_idx
      ON procore_prime_contracts_live (synced_at DESC)
  `);
}

async function upsertPrimeContractLive(params: {
  companyId: string;
  projectId: string;
  record: PrimeContractRecord;
}) {
  const { companyId, projectId, record } = params;

  const primeContractId = readText(record.id);
  if (!primeContractId) return;

  const contractDate = toNullableDate(record.contract_date);
  const signedContractDate = toNullableDate(record.signed_contract_received_date);
  const executionDate = toNullableDate(record.execution_date);
  const contractStartDate = toNullableDate(record.contract_start_date);

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_prime_contracts_live
        (prime_contract_id, company_id, project_id, project_procore_id, number, title, status,
         contract_date, signed_contract_received_date, execution_date, contract_start_date, payload, synced_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12::jsonb, NOW())
      ON CONFLICT (prime_contract_id)
      DO UPDATE SET
        company_id = EXCLUDED.company_id,
        project_id = EXCLUDED.project_id,
        project_procore_id = EXCLUDED.project_procore_id,
        number = EXCLUDED.number,
        title = EXCLUDED.title,
        status = EXCLUDED.status,
        contract_date = EXCLUDED.contract_date,
        signed_contract_received_date = EXCLUDED.signed_contract_received_date,
        execution_date = EXCLUDED.execution_date,
        contract_start_date = EXCLUDED.contract_start_date,
        payload = EXCLUDED.payload,
        synced_at = NOW()
    `,
    primeContractId,
    companyId,
    projectId,
    projectId,
    readText(record.number) || null,
    readText(record.title) || null,
    readText(record.status) || null,
    contractDate,
    signedContractDate,
    executionDate,
    contractStartDate,
    JSON.stringify(record)
  );
}

async function updateProjectContractDate(params: {
  projectId: string;
  records: PrimeContractRecord[];
}) {
  const { projectId, records } = params;

  const best = records
    .map((record) => ({
      record,
      normalized: normalizeContractDate(record),
      updatedAt: toNullableDate(record.updated_at),
    }))
    .sort((a, b) => {
      const bNorm = b.normalized ? b.normalized.getTime() : 0;
      const aNorm = a.normalized ? a.normalized.getTime() : 0;
      if (bNorm !== aNorm) return bNorm - aNorm;
      const bUpd = b.updatedAt ? b.updatedAt.getTime() : 0;
      const aUpd = a.updatedAt ? a.updatedAt.getTime() : 0;
      return bUpd - aUpd;
    })[0];

  if (!best) return;

  const normalizedContractDate = best.normalized;
  const contractStartDate = toNullableDate(best.record.contract_start_date);
  const primeContractId = readText(best.record.id) || null;

  const project = await prisma.project.findFirst({
    where: {
      OR: [
        { procoreId: projectId },
        { customFields: { path: ["procoreId"], equals: projectId } },
        { customFields: { path: ["procoreProjectId"], equals: projectId } },
      ],
    },
    select: { id: true, customFields: true },
  });

  if (!project) return;

  const existingCustomFields =
    project.customFields && typeof project.customFields === "object" && !Array.isArray(project.customFields)
      ? (project.customFields as Record<string, unknown>)
      : {};

  await prisma.project.update({
    where: { id: project.id },
    data: {
      customFields: {
        ...existingCustomFields,
        procorePrimeContractId: primeContractId,
        contractDate: normalizedContractDate ? normalizedContractDate.toISOString() : null,
        contractStartDate: contractStartDate ? contractStartDate.toISOString() : null,
        contractDateSource: "procore_prime_contracts",
        contractDateSyncedAt: new Date().toISOString(),
      },
    },
  });
}

async function fetchAllProjects(
  requestFn: (endpoint: string) => Promise<unknown>,
  companyId: string,
  maxProjects?: number
): Promise<ProcoreProject[]> {
  const projects: ProcoreProject[] = [];
  const perPage = 100;
  let page = 1;
  while (true) {
    const endpoint = `/rest/v1.0/projects?company_id=${encodeURIComponent(companyId)}&page=${page}&per_page=${perPage}`;
    const response = await requestFn(endpoint);
    const pageItems = Array.isArray(response) ? (response as ProcoreProject[]) : [];
    if (!pageItems.length) break;
    projects.push(...pageItems);
    if ((maxProjects || 0) > 0 && projects.length >= (maxProjects || 0)) {
      return projects.slice(0, maxProjects);
    }
    if (pageItems.length < perPage) break;
    page += 1;
    if (page > 200) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  return projects;
}

async function fetchAllPrimeContractsForProject(params: {
  requestFn: (endpoint: string) => Promise<unknown>;
  companyId: string;
  projectId: string;
  perPage: number;
  filterIds?: string[];
  filterUpdatedAt?: string;
}): Promise<{ records: PrimeContractRecord[]; notEnabled: boolean }> {
  const records: PrimeContractRecord[] = [];
  let page = 1;
  while (true) {
    const qs = new URLSearchParams();
    qs.set("project_id", params.projectId);
    qs.set("page", String(page));
    qs.set("per_page", String(params.perPage));
    if (params.filterIds && params.filterIds.length > 0) {
      qs.set("filters[id]", params.filterIds.join(","));
    }
    if (params.filterUpdatedAt) {
      qs.set("filters[updated_at]", params.filterUpdatedAt);
    }

    const endpoint = `/rest/v1.0/prime_contracts?${qs.toString()}`;
    let response: unknown;
    try {
      response = await params.requestFn(endpoint);
    } catch (err) {
      if (isNotFoundError(err)) return { records: [], notEnabled: true };
      throw err;
    }

    const pageRecords = Array.isArray(response)
      ? (response as PrimeContractRecord[])
      : [];
    if (!pageRecords.length) break;
    records.push(...pageRecords);
    if (pageRecords.length < params.perPage) break;
    page += 1;
    if (page > 100) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  return { records, notEnabled: false };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function runner() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, () => runner())
  );
  return results;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const cookieStore = await cookies();

    const explicitAccessToken = readText(body.accessToken) || undefined;
    const userAccessToken = readText(cookieStore.get("procore_access_token")?.value) || undefined;

    const companyId = readText(
      body?.companyId ||
        cookieStore.get("procore_company_id")?.value ||
        procoreConfig.companyId ||
        ""
    );

    let accessToken: string | undefined;
    let tokenSource: "explicit" | "client_credentials" | "user_oauth" | "user_oauth_fallback" = "user_oauth";
    if (explicitAccessToken) {
      accessToken = explicitAccessToken;
      tokenSource = "explicit";
    } else {
      try {
        accessToken = await getClientCredentialsToken();
        tokenSource = "client_credentials";
      } catch {
        accessToken = userAccessToken;
        tokenSource = "user_oauth";
      }
    }

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token.", connectUrl: "/api/auth/procore/login" },
        { status: 401 }
      );
    }

    function isAppOwnerForbidden(error: unknown): boolean {
      const message = error instanceof Error ? error.message : String(error);
      return /\b403\b/.test(message) && /Unpermitted access for the app owner/i.test(message);
    }

    const requestWithFallback = async (endpoint: string): Promise<unknown> => {
      try {
        return await makeRequest(endpoint, accessToken!, undefined, companyId);
      } catch (error: unknown) {
        if (tokenSource === "client_credentials" && userAccessToken && isAppOwnerForbidden(error)) {
          console.warn(`[Prime Contracts Sync] client_credentials forbidden for endpoint ${endpoint}; retrying with user OAuth token.`);
          accessToken = userAccessToken;
          tokenSource = "user_oauth_fallback";
          return await makeRequest(endpoint, accessToken, undefined, companyId);
        }
        throw error;
      }
    };

    if (!companyId) {
      return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    }

    const perPage = Math.min(200, Math.max(1, Number.parseInt(String(body.perPage || "100"), 10) || 100));
    const concurrency = Math.min(8, Math.max(1, Number.parseInt(String(body.concurrency || "2"), 10) || 2));
    const maxProjects = Math.max(0, Number.parseInt(String(body.maxProjects || "0"), 10) || 0);
    const rawFilterIds = body["filters[id]"] ?? body.filterIds;
    const filterIds = Array.isArray(rawFilterIds)
      ? rawFilterIds.map((v) => readText(v)).filter(Boolean)
      : readText(rawFilterIds)
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean);
    const filterUpdatedAt = readText(body["filters[updated_at]"] ?? body.filterUpdatedAt);

    const projects = await fetchAllProjects(requestWithFallback, companyId, maxProjects || undefined);

    // Ensure table exists once before any upserts
    await ensurePrimeContractsLiveTable();

    const summary = {
      success: true,
      tokenSource,
      companyId,
      totalProjectsChecked: projects.length,
      projectsWithContracts: 0,
      totalContractsFetched: 0,
      totalContractsSaved: 0,
      activeProjects: [] as Array<{
        projectId: string;
        projectNumber: string | null;
        projectName: string;
        contractCount: number;
        savedCount: number;
      }>,
      errors: [] as string[],
    };

    await mapWithConcurrency(projects, concurrency, async (project) => {
      const projectId = readText(
        (project as Record<string, unknown>).id ?? (project as Record<string, unknown>).project_id ?? ""
      );
      if (!projectId) return;

      const projectNumber = firstText(
        (project as Record<string, unknown>).project_number,
        (project as Record<string, unknown>).number
      );
      const projectName = firstText(
        (project as Record<string, unknown>).name,
        (project as Record<string, unknown>).project_name,
        `Procore Project ${projectId}`
      );

      try {
        const { records, notEnabled } = await fetchAllPrimeContractsForProject({
          requestFn: requestWithFallback,
          companyId,
          projectId,
          perPage,
          filterIds,
          filterUpdatedAt,
        });

        if (notEnabled || !records.length) return;

        summary.totalContractsFetched += records.length;
        summary.projectsWithContracts += 1;

        let savedCount = 0;
        for (const record of records) {
          await upsertPrimeContractLive({ companyId, projectId, record });
          savedCount += 1;
        }

        await updateProjectContractDate({ projectId, records });

        summary.totalContractsSaved += savedCount;
        summary.activeProjects.push({
          projectId,
          projectNumber: projectNumber || null,
          projectName,
          contractCount: records.length,
          savedCount,
        });
      } catch (err) {
        summary.errors.push(
          `Project ${projectId} (${projectName}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    });

    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

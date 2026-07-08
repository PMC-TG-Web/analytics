import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  makeRequest,
  procoreConfig,
  getClientCredentialsToken,
  withProcoreLiveApiBypassForAuthenticatedSession,
} from "@/lib/procore";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { extractCustomerFromCustomFields, isMeaningfulCustomer } from "@/lib/procoreProjectFeed";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";

const DEFAULT_ESTIMATING_BASE_URL = "https://api.procore.com";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function unwrapBidBoardProjects(payload: unknown): unknown[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  const candidates = [payload.data, payload.projects, payload.bid_board_projects];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return [];
}

function mapV1StatusToBidBoardStatus(status: string | null | undefined): string | null {
  return normalizeBidBoardStatus(status);
}

function toPrismaJsonValue(value: unknown): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function normalizeBidBoardStatus(status: string | null | undefined): string | null {
  const raw = String(status || "").trim();
  const normalized = raw
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ");

  if (!normalized) return null;
  if (normalized === "bid submitted" || normalized === "bidding") return "Bid Submitted";
  if (normalized === "pre construction" || normalized === "estimating") return "Estimating";
  if (normalized === "post construction" || normalized === "complete") return "Complete";
  if (normalized === "active" || normalized === "in progress" || normalized === "course of construction") return "In Progress";
  if (normalized === "accepted") return "Accepted";
  if (normalized === "invitation" || normalized === "invitations") return "Invitations";
  if (normalized === "lost") return "Lost";
  if (normalized === "to do" || normalized === "todo") return "To Do";

  return normalized.replace(/\b\w/g, (char) => char.toUpperCase());
}

async function ensureEndpointLiveTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS procore_bid_board_live (
      bid_board_id TEXT PRIMARY KEY,
      company_id TEXT,
      procore_project_id TEXT,
      name TEXT,
      status TEXT,
      status_raw TEXT,
      customer TEXT,
      payload JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS procore_bid_board_live_procore_project_id_idx
      ON procore_bid_board_live (procore_project_id)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS procore_bid_board_live_status_idx
      ON procore_bid_board_live (status)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS procore_bid_board_live_synced_at_idx
      ON procore_bid_board_live (synced_at DESC)
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS procore_project_stages_live (
      project_stage_id TEXT PRIMARY KEY,
      company_id TEXT,
      name TEXT,
      category TEXT,
      is_bidding_stage BOOLEAN,
      default_stage BOOLEAN,
      has_children BOOLEAN,
      payload JSONB NOT NULL,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS procore_project_stages_live_name_idx
      ON procore_project_stages_live (name)
  `);

  // Add new columns if they don't exist yet (safe for existing tables)
  await prisma.$executeRawUnsafe(`
    ALTER TABLE procore_project_stages_live
      ADD COLUMN IF NOT EXISTS default_stage BOOLEAN,
      ADD COLUMN IF NOT EXISTS has_children BOOLEAN
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS procore_project_stages_live_synced_at_idx
      ON procore_project_stages_live (synced_at DESC)
  `);

  await prisma.$executeRawUnsafe(`
    ALTER TABLE procore_project_staging
      ADD COLUMN IF NOT EXISTS bid_board_status TEXT NULL
  `);
}

async function upsertBidBoardLive(params: {
  companyId: string;
  bidBoardId: string;
  procoreProjectId?: string | null;
  name?: string | null;
  status?: string | null;
  statusRaw?: string | null;
  customer?: string | null;
  payload: unknown;
}) {
  const {
    companyId,
    bidBoardId,
    procoreProjectId,
    name,
    status,
    statusRaw,
    customer,
    payload,
  } = params;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_bid_board_live
        (bid_board_id, company_id, procore_project_id, name, status, status_raw, customer, payload, synced_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
      ON CONFLICT (bid_board_id)
      DO UPDATE SET
        company_id = EXCLUDED.company_id,
        procore_project_id = EXCLUDED.procore_project_id,
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        status_raw = EXCLUDED.status_raw,
        customer = EXCLUDED.customer,
        payload = EXCLUDED.payload,
        synced_at = NOW()
    `,
    bidBoardId,
    companyId,
    procoreProjectId ?? null,
    name ?? null,
    status ?? null,
    statusRaw ?? null,
    customer ?? null,
    JSON.stringify(payload)
  );
}

async function upsertProjectStageLive(params: {
  companyId: string;
  projectStageId: string;
  name?: string | null;
  category?: string | null;
  isBiddingStage?: boolean | null;
  defaultStage?: boolean | null;
  hasChildren?: boolean | null;
  payload: unknown;
}) {
  const {
    companyId,
    projectStageId,
    name,
    category,
    isBiddingStage,
    defaultStage,
    hasChildren,
    payload,
  } = params;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_project_stages_live
        (project_stage_id, company_id, name, category, is_bidding_stage, default_stage, has_children, payload, synced_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
      ON CONFLICT (project_stage_id)
      DO UPDATE SET
        company_id = EXCLUDED.company_id,
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        is_bidding_stage = EXCLUDED.is_bidding_stage,
        default_stage = EXCLUDED.default_stage,
        has_children = EXCLUDED.has_children,
        payload = EXCLUDED.payload,
        synced_at = NOW()
    `,
    projectStageId,
    companyId,
    name ?? null,
    category ?? null,
    typeof isBiddingStage === 'boolean' ? isBiddingStage : null,
    typeof defaultStage === 'boolean' ? defaultStage : null,
    typeof hasChildren === 'boolean' ? hasChildren : null,
    JSON.stringify(payload)
  );
}

async function upsertProcoreStaging(params: {
  source: string;
  companyId: string;
  externalId: string;
  procoreProjectId?: string | null;
  name?: string | null;
  status?: string | null;
  bidBoardStatus?: string | null;
  customer?: string | null;
  payload: unknown;
}) {
  const {
    source,
    companyId,
    externalId,
    procoreProjectId,
    name,
    status,
    bidBoardStatus,
    customer,
    payload,
  } = params;

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_project_staging
        (source, company_id, external_id, procore_project_id, name, status, bid_board_status, customer, payload, synced_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
      ON CONFLICT (source, company_id, external_id)
      DO UPDATE SET
        procore_project_id = EXCLUDED.procore_project_id,
        name = EXCLUDED.name,
        status = EXCLUDED.status,
        bid_board_status = EXCLUDED.bid_board_status,
        customer = EXCLUDED.customer,
        payload = EXCLUDED.payload,
        synced_at = NOW()
    `,
    source,
    companyId,
    externalId,
    procoreProjectId ?? null,
    name ?? null,
    status ?? null,
    bidBoardStatus ?? null,
    customer ?? null,
    JSON.stringify(payload)
  );
}

async function upsertPmcProject(params: {
  companyId: string;
  procoreProjectId: string;
  bidBoardId?: string | null;
  projectNumber?: string | null;
  projectName: string;
  customer?: string | null;
  status?: string | null;
  bidBoardStatus?: string | null;
  projectManager?: string | null;
  estimator?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  procoreCreatedAt?: Date | null;
  procoreUpdatedAt?: Date | null;
}) {
  const {
    companyId,
    procoreProjectId,
    bidBoardId,
    projectNumber,
    projectName,
    customer,
    status,
    bidBoardStatus,
    projectManager,
    estimator,
    address,
    city,
    state,
    zip,
    procoreCreatedAt,
    procoreUpdatedAt,
  } = params;

  await prisma.pmcProject.upsert({
    where: {
      companyId_procoreProjectId: {
        companyId,
        procoreProjectId,
      },
    },
    create: {
      companyId,
      procoreProjectId,
      bidBoardId: bidBoardId || null,
      projectNumber: projectNumber || null,
      projectName,
      customer: customer || null,
      status: status || null,
      bidBoardStatus: bidBoardStatus || null,
      projectManager: projectManager || null,
      estimator: estimator || null,
      address: address || null,
      city: city || null,
      state: state || null,
      zip: zip || null,
      procoreCreatedAt: procoreCreatedAt || null,
      procoreUpdatedAt: procoreUpdatedAt || null,
      syncedAt: new Date(),
    },
    update: {
      bidBoardId: bidBoardId || null,
      projectNumber: projectNumber || null,
      projectName,
      customer: customer || null,
      status: status || null,
      bidBoardStatus: bidBoardStatus || null,
      projectManager: projectManager || null,
      estimator: estimator || null,
      address: address || null,
      city: city || null,
      state: state || null,
      zip: zip || null,
      procoreCreatedAt: procoreCreatedAt || null,
      procoreUpdatedAt: procoreUpdatedAt || null,
      syncedAt: new Date(),
    },
  });
}

async function upsertPmcBidBoardProject(params: {
  companyId: string;
  bidBoardId: string;
  procoreProjectId?: string | null;
  projectNumber?: string | null;
  projectName: string;
  customer?: string | null;
  customerCompanyId?: string | null;
  status?: string | null;
  statusRaw?: string | null;
  payload?: unknown;
}) {
  const {
    companyId,
    bidBoardId,
    procoreProjectId,
    projectNumber,
    projectName,
    customer,
    customerCompanyId,
    status,
    statusRaw,
    payload,
  } = params;

  await prisma.pmcBidBoardProject.upsert({
    where: {
      companyId_bidBoardId: {
        companyId,
        bidBoardId,
      },
    },
    create: {
      companyId,
      bidBoardId,
      procoreProjectId: procoreProjectId || null,
      projectNumber: projectNumber || null,
      projectName,
      customer: customer || null,
      customerCompanyId: customerCompanyId || null,
      status: status || null,
      statusRaw: statusRaw || null,
      payload: toPrismaJsonValue(payload),
      syncedAt: new Date(),
    },
    update: {
      procoreProjectId: procoreProjectId || null,
      projectNumber: projectNumber || null,
      projectName,
      customer: customer || null,
      customerCompanyId: customerCompanyId || null,
      status: status || null,
      statusRaw: statusRaw || null,
      payload: toPrismaJsonValue(payload),
      syncedAt: new Date(),
    },
  });
}

async function applyBidBoardStatusToV1Staging(params: {
  companyId: string;
  procoreProjectId?: string | null;
  bidBoardStatus?: string | null;
  bidBoardId?: string | null;
  bidBoardName?: string | null;
  customer?: string | null;
}) {
  const { companyId, procoreProjectId, bidBoardStatus, bidBoardId, bidBoardName, customer } = params;

  // First attempt: exact match by Procore project id.
  if (procoreProjectId) {
    const updatedById = await prisma.$executeRawUnsafe(
      `
        UPDATE procore_project_staging
        SET
          bid_board_status = $1,
          payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
            'bidBoardStatus', $1,
            'bidBoardExternalId', $2,
            'bidBoardSyncedAt', NOW()::text
          ),
          synced_at = NOW()
        WHERE source = 'procore_v1_projects'
          AND company_id = $3
          AND procore_project_id = $4
      `,
      bidBoardStatus ?? null,
      bidBoardId ?? null,
      companyId,
      procoreProjectId
    );

    if (updatedById > 0) return updatedById;
  }

  // Fallback: match one best candidate by normalized name (and customer priority when available).
  const normalizedName = String(bidBoardName || '').trim();
  if (!normalizedName) return 0;
  const normalizedCustomer = isMeaningfulCustomer(customer) ? String(customer).trim() : null;

  return prisma.$executeRawUnsafe(
    `
      WITH candidate AS (
        SELECT ctid
        FROM procore_project_staging
        WHERE source = 'procore_v1_projects'
          AND company_id = $3
          AND LOWER(BTRIM(COALESCE(name, ''))) = LOWER(BTRIM($4))
        ORDER BY
          CASE
            WHEN $5::text IS NOT NULL
              AND LOWER(BTRIM(COALESCE(customer, ''))) = LOWER(BTRIM($5::text))
            THEN 0 ELSE 1
          END,
          synced_at DESC
        LIMIT 1
      )
      UPDATE procore_project_staging s
      SET
        bid_board_status = $1,
        payload = COALESCE(s.payload, '{}'::jsonb) || jsonb_build_object(
          'bidBoardStatus', $1,
          'bidBoardExternalId', $2,
          'bidBoardSyncedAt', NOW()::text,
          'bidBoardMatchMode', 'name_fallback'
        ),
        synced_at = NOW()
      FROM candidate
      WHERE s.ctid = candidate.ctid
    `,
    bidBoardStatus ?? null,
    bidBoardId ?? null,
    companyId,
    normalizedName,
    normalizedCustomer
  );
}

export async function POST(request: Request) {
  return withProcoreLiveApiBypassForAuthenticatedSession(request, async () => {
    try {
    const body = await request.json().catch(() => ({}));

    const parseDebugIds = (input: unknown): string[] => {
      if (Array.isArray(input)) {
        return input.map((v) => String(v).trim()).filter(Boolean);
      }
      const text = String(input ?? '').trim();
      if (!text) return [];
      return text.split(',').map((v) => v.trim()).filter(Boolean);
    };

    const {
      fetchAll = false,
      forceUserOAuth = false,
      includeInactiveV1 = false,
      includeTestProjects = false,
      includePrimeContractProjectBackfill = false,
      usePrimeContractProjectIdsAsTruth = false,
      seedFromFile = false,
      primeByIdConcurrency: bodyPrimeByIdConcurrency,
      maxPages: bodyMaxPages,
      debugProjectIds: bodyDebugProjectIds,
      companyId: bodyCompanyId,
    } = body;
    const debugProjectIds = parseDebugIds(bodyDebugProjectIds);
    const parsedPrimeByIdConcurrency = Number.parseInt(String(bodyPrimeByIdConcurrency ?? '2'), 10);
    const primeByIdConcurrency = Math.min(4, Math.max(1, Number.isFinite(parsedPrimeByIdConcurrency) ? parsedPrimeByIdConcurrency : 2));
    const parsedMaxPages = Number.parseInt(String(bodyMaxPages ?? '3'), 10);
    const maxPages = fetchAll ? Math.min(200, Math.max(1, Number.isFinite(parsedMaxPages) ? parsedMaxPages : 3)) : 1;

    const cookieStore = await cookies();
    const userAccessToken = cookieStore.get("procore_access_token")?.value;
    const companyId = String(
      bodyCompanyId ||
      cookieStore.get("procore_company_id")?.value ||
      procoreConfig.companyId ||
      process.env.PROCORE_COMPANY_ID ||
      process.env.NEXT_PUBLIC_PROCORE_COMPANY_ID ||
      ''
    ).trim();

    if (!companyId) {
      return NextResponse.json(
        {
          error: "MISSING_COMPANY_ID: The Procore Company ID is not configured.",
          details: "Provide companyId in request body or set PROCORE_COMPANY_ID in environment.",
        },
        { status: 400 }
      );
    }

    if (!userAccessToken && !procoreConfig.clientId) {
      return NextResponse.json({ error: "Missing access token. Please login via OAuth." }, { status: 401 });
    }

    // Prefer client_credentials (service account) so all company projects are visible.
    // Client credentials have company-level access; user OAuth only sees projects where the user is a member.
    let accessToken: string;
    let tokenSource: string;
    try {
      if (forceUserOAuth) {
        if (!userAccessToken) {
          return NextResponse.json({ error: "Missing access token. Please login via OAuth." }, { status: 401 });
        }
        accessToken = userAccessToken;
        tokenSource = 'user_oauth_forced';
      } else {
        accessToken = await getClientCredentialsToken();
        tokenSource = 'client_credentials';
      }
    } catch {
      if (!userAccessToken) {
        return NextResponse.json({ error: "Missing access token. Please login via OAuth." }, { status: 401 });
      }
      accessToken = userAccessToken;
      tokenSource = 'user_oauth';
    }
    console.log(`[Sync] Using token source: ${tokenSource}`);

    function isAppOwnerForbidden(error: unknown): boolean {
      const message = error instanceof Error ? error.message : String(error);
      return /\b403\b/.test(message) && /Unpermitted access for the app owner/i.test(message);
    }

    async function makeProcoreRequestWithFallback(endpoint: string): Promise<unknown> {
      try {
        return await makeRequest(endpoint, accessToken, undefined, companyId);
      } catch (error: unknown) {
        if (tokenSource === 'client_credentials' && userAccessToken && isAppOwnerForbidden(error)) {
          console.warn(`[Sync] client_credentials forbidden for endpoint ${endpoint}; retrying with user OAuth token.`);
          accessToken = userAccessToken;
          tokenSource = 'user_oauth_fallback';
          return await makeRequest(endpoint, accessToken, undefined, companyId);
        }
        throw error;
      }
    }

    console.log(`Starting full Procore sync for company ${companyId}`);

    // 1. Fetch V1 Projects (active + optionally inactive + optionally test/demo)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function fetchV1Projects(filters?: { active?: boolean; isDemo?: boolean }): Promise<any[]> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const projects: any[] = [];
      const { active, isDemo } = filters ?? {};
      let page = 1;
      while (true) {
        const qs = new URLSearchParams({
          company_id: companyId,
          page: String(page),
          per_page: '100',
        });
        if (typeof active === 'boolean') {
          qs.set('filters[active]', active ? 'true' : 'false');
        }
        if (typeof isDemo === 'boolean') {
          qs.set('filters[is_demo]', isDemo ? 'true' : 'false');
        }
        const endpoint = `/rest/v1.0/projects?${qs.toString()}`;
        let data: unknown;
        try {
          data = await makeProcoreRequestWithFallback(endpoint);
        } catch (error: unknown) {
          // Some Procore tenants may not support filters[is_demo] on list endpoint.
          // If that happens, skip this test/demo pass instead of failing entire sync.
          const message = error instanceof Error ? error.message : String(error);
          const isBadRequest = /\b400\b/.test(message);
          if (typeof isDemo === 'boolean' && isBadRequest) {
            console.warn(`Skipping demo-filtered V1 fetch; filter unsupported: ${message}`);
            break;
          }
          throw error;
        }
        if (!Array.isArray(data) || data.length === 0) break;
        projects.push(...data);
        if (data.length < 100 || !fetchAll) break;
        page++;
        if (page > maxPages) break;
        await new Promise((r) => setTimeout(r, 150));
      }
      return projects;
    }

    async function fetchPrimeContractProjectIds(): Promise<{
      ids: string[];
      stats: {
        distinctByProjectId: number;
        distinctByProjectProcoreId: number;
        distinctFromContractorProjectIds: number;
        distinctFromVendorProjectIds: number;
        distinctCoalesced: number;
      };
    }> {
      try {
        const statRows = await prisma.$queryRawUnsafe<Array<{
          distinct_by_project_id: number;
          distinct_by_project_procore_id: number;
          distinct_from_contractor_project_ids: number;
          distinct_from_vendor_project_ids: number;
          distinct_coalesced: number;
        }>>(
          `
            WITH source_ids AS (
              SELECT NULLIF(BTRIM(project_id), '') AS pid
              FROM procore_prime_contracts_live
              UNION
              SELECT NULLIF(BTRIM(project_procore_id), '') AS pid
              FROM procore_prime_contracts_live
              UNION
              SELECT NULLIF(BTRIM(value), '') AS pid
              FROM procore_prime_contracts_live
              CROSS JOIN LATERAL jsonb_array_elements_text(
                COALESCE(payload->'contractor'->'project_ids', '[]'::jsonb)
              ) AS value
              UNION
              SELECT NULLIF(BTRIM(value), '') AS pid
              FROM procore_prime_contracts_live
              CROSS JOIN LATERAL jsonb_array_elements_text(
                COALESCE(payload->'vendor'->'project_ids', '[]'::jsonb)
              ) AS value
            )
            SELECT
              (
                SELECT COUNT(DISTINCT NULLIF(BTRIM(project_id), ''))::int
                FROM procore_prime_contracts_live
              ) AS distinct_by_project_id,
              (
                SELECT COUNT(DISTINCT NULLIF(BTRIM(project_procore_id), ''))::int
                FROM procore_prime_contracts_live
              ) AS distinct_by_project_procore_id,
              (
                SELECT COUNT(DISTINCT NULLIF(BTRIM(value), ''))::int
                FROM procore_prime_contracts_live p1
                CROSS JOIN LATERAL jsonb_array_elements_text(
                  COALESCE(p1.payload->'contractor'->'project_ids', '[]'::jsonb)
                ) AS value
              ) AS distinct_from_contractor_project_ids,
              (
                SELECT COUNT(DISTINCT NULLIF(BTRIM(value), ''))::int
                FROM procore_prime_contracts_live p2
                CROSS JOIN LATERAL jsonb_array_elements_text(
                  COALESCE(p2.payload->'vendor'->'project_ids', '[]'::jsonb)
                ) AS value
              ) AS distinct_from_vendor_project_ids,
              (SELECT COUNT(DISTINCT pid)::int FROM source_ids WHERE pid IS NOT NULL) AS distinct_coalesced
          `
        );

        const rows = await prisma.$queryRawUnsafe<Array<{ procore_project_id: string | null }>>(
          `
            WITH source_ids AS (
              SELECT NULLIF(BTRIM(project_id), '') AS pid
              FROM procore_prime_contracts_live
              UNION
              SELECT NULLIF(BTRIM(project_procore_id), '') AS pid
              FROM procore_prime_contracts_live
              UNION
              SELECT NULLIF(BTRIM(value), '') AS pid
              FROM procore_prime_contracts_live
              CROSS JOIN LATERAL jsonb_array_elements_text(
                COALESCE(payload->'contractor'->'project_ids', '[]'::jsonb)
              ) AS value
              UNION
              SELECT NULLIF(BTRIM(value), '') AS pid
              FROM procore_prime_contracts_live
              CROSS JOIN LATERAL jsonb_array_elements_text(
                COALESCE(payload->'vendor'->'project_ids', '[]'::jsonb)
              ) AS value
            )
            SELECT DISTINCT pid AS procore_project_id
            FROM source_ids
            WHERE pid IS NOT NULL
          `
        );

        const ids = rows
          .map((row) => String(row.procore_project_id || '').trim())
          .filter(Boolean);

        const statsRow = statRows[0] || {
          distinct_by_project_id: 0,
          distinct_by_project_procore_id: 0,
          distinct_from_contractor_project_ids: 0,
          distinct_from_vendor_project_ids: 0,
          distinct_coalesced: 0,
        };

        return {
          ids,
          stats: {
            distinctByProjectId: Number(statsRow.distinct_by_project_id || 0),
            distinctByProjectProcoreId: Number(statsRow.distinct_by_project_procore_id || 0),
            distinctFromContractorProjectIds: Number(statsRow.distinct_from_contractor_project_ids || 0),
            distinctFromVendorProjectIds: Number(statsRow.distinct_from_vendor_project_ids || 0),
            distinctCoalesced: Number(statsRow.distinct_coalesced || 0),
          },
        };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (/does not exist|relation|p2021|p2022/i.test(message)) {
          console.warn(`Prime contracts table unavailable for project backfill: ${message}`);
          return {
            ids: [],
            stats: {
              distinctByProjectId: 0,
              distinctByProjectProcoreId: 0,
              distinctFromContractorProjectIds: 0,
              distinctFromVendorProjectIds: 0,
              distinctCoalesced: 0,
            },
          };
        }
        throw error;
      }
    }

    async function mapWithConcurrency<T, R>(
      items: T[],
      limit: number,
      worker: (item: T, index: number) => Promise<R>
    ): Promise<R[]> {
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

    const activeV1Projects = await fetchV1Projects({ active: true });
    const inactiveV1Projects = includeInactiveV1 ? await fetchV1Projects({ active: false }) : [];
    const testActiveV1Projects = includeTestProjects ? await fetchV1Projects({ active: true, isDemo: true }) : [];
    const testInactiveV1Projects = includeTestProjects && includeInactiveV1
      ? await fetchV1Projects({ active: false, isDemo: true })
      : [];

    const passIds = {
      active: new Set(activeV1Projects.map((p: Record<string, unknown>) => String(p?.id ?? '')).filter(Boolean)),
      inactive: new Set(inactiveV1Projects.map((p: Record<string, unknown>) => String(p?.id ?? '')).filter(Boolean)),
      testActive: new Set(testActiveV1Projects.map((p: Record<string, unknown>) => String(p?.id ?? '')).filter(Boolean)),
      testInactive: new Set(testInactiveV1Projects.map((p: Record<string, unknown>) => String(p?.id ?? '')).filter(Boolean)),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v1ById = new Map<string, any>();
    for (const p of [
      ...activeV1Projects,
      ...inactiveV1Projects,
      ...testActiveV1Projects,
      ...testInactiveV1Projects,
    ]) {
      const row = p as Record<string, unknown>;
      if (row?.id == null) continue;
      v1ById.set(String(row.id), p);
    }

    const primeBackfillStats = {
      enabled: Boolean(includePrimeContractProjectBackfill),
      truthMode: Boolean(usePrimeContractProjectIdsAsTruth),
      seedFromFile: Boolean(seedFromFile),
      seedFileIds: 0,
      sourceCounts: {
        distinctByProjectId: 0,
        distinctByProjectProcoreId: 0,
        distinctCoalesced: 0,
      },
      idsFromPrimeContracts: 0,
      requestedById: 0,
      missingFromList: 0,
      fetchedById: 0,
      fetchErrors: 0,
      failedById: [] as Array<{ id: string; error: string }>,
    };

    if (seedFromFile) {
      console.warn("seedFromFile was requested, but repo-local seed files are disabled in production.");
    }

    if (includePrimeContractProjectBackfill) {
      const primeResult = await fetchPrimeContractProjectIds();
      const primeIds = primeResult.ids;
      primeBackfillStats.sourceCounts = primeResult.stats;
      primeBackfillStats.idsFromPrimeContracts = primeIds.length;

      const allIds = Array.from(new Set(primeIds));
      primeBackfillStats.requestedById = allIds.length;

      const missingIds = allIds.filter((id) => !v1ById.has(id));
      primeBackfillStats.missingFromList = missingIds.length;

      if (allIds.length > 0) {
        const fetchedRows = await mapWithConcurrency(allIds, primeByIdConcurrency, async (id) => {
          try {
            const endpoint = `/rest/v1.0/projects/${encodeURIComponent(id)}?company_id=${encodeURIComponent(companyId)}`;
            const row = await makeProcoreRequestWithFallback(endpoint);
            return { id, row, error: null as string | null };
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return { id, row: null, error: message };
          }
        });

        // Prime-contract IDs are authoritative when truth mode is enabled.
        if (usePrimeContractProjectIdsAsTruth) {
          v1ById.clear();
        }

        for (const result of fetchedRows) {
          if (result.row && typeof result.row === 'object') {
            const rowObj = result.row as Record<string, unknown>;
            const rowId = String(rowObj.id ?? result.id).trim();
            if (rowId) {
              v1ById.set(rowId, result.row);
              primeBackfillStats.fetchedById++;
            }
          } else {
            primeBackfillStats.fetchErrors++;
            if (primeBackfillStats.failedById.length < 50) {
              primeBackfillStats.failedById.push({
                id: result.id,
                error: result.error || 'Unknown by-id fetch error',
              });
            }
          }
        }
      }
    }

    const allV1Projects = Array.from(v1ById.values());

    const debugComparison: Array<{
      id: string;
      inList: boolean;
      inPasses: string[];
      inDedupedV1: boolean;
      inV11List?: boolean;
      byIdOk: boolean;
      byIdStatus: number;
      byIdName?: string | null;
      byIdProjectNumber?: string | null;
      byIdActive?: boolean | null;
      byIdIsDemo?: boolean | null;
      byIdStage?: string | null;
      byIdUpdatedAt?: string | null;
      byIdFlags?: Record<string, unknown>;
      byIdError?: string;
    }> = [];

    if (debugProjectIds.length > 0) {
      const debugIdSet = new Set(debugProjectIds);
      const v11Ids = new Set<string>();
      let v11Page = 1;
      while (true) {
        const qs = new URLSearchParams({
          company_id: companyId,
          page: String(v11Page),
          per_page: '100',
        });
        const endpoint = `/rest/v1.1/projects?${qs.toString()}`;
        let v11Data: unknown;
        try {
          v11Data = await makeProcoreRequestWithFallback(endpoint);
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`Skipping v1.1 list debug scan: ${message}`);
          break;
        }

        if (!Array.isArray(v11Data) || v11Data.length === 0) break;

        for (const row of v11Data as Array<Record<string, unknown>>) {
          const rowId = String(row?.id ?? '').trim();
          if (!rowId) continue;
          if (debugIdSet.has(rowId)) v11Ids.add(rowId);
        }

        if (v11Data.length < 100 || !fetchAll) break;
        v11Page++;
        if (v11Page > maxPages) break;
      }

      for (const id of debugProjectIds) {
        const inPasses: string[] = [];
        if (passIds.active.has(id)) inPasses.push('active');
        if (passIds.inactive.has(id)) inPasses.push('inactive');
        if (passIds.testActive.has(id)) inPasses.push('testActive');
        if (passIds.testInactive.has(id)) inPasses.push('testInactive');

        const inList = inPasses.length > 0;
        const inDedupedV1 = v1ById.has(id);

        try {
          const endpoint = `/rest/v1.0/projects/${encodeURIComponent(id)}?company_id=${encodeURIComponent(companyId)}`;
          const row = (await makeProcoreRequestWithFallback(endpoint)) as {
            name?: string;
            display_name?: string;
            project_number?: string;
            active?: boolean;
            is_demo?: boolean;
            stage?: string;
            project_stage?: { name?: string };
            updated_at?: string;
          } & Record<string, unknown>;

          const byIdFlags = {
            active: row.active,
            is_demo: row.is_demo,
            stage: row.stage || row.project_stage?.name || null,
            project_type: row.project_type ?? null,
            project_state: row.project_state ?? null,
            project_status_id: row.project_status_id ?? null,
            project_stage_id: row.project_stage_id ?? null,
            archived_at: row.archived_at ?? null,
            deleted_at: row.deleted_at ?? null,
            completed_at: row.completed_at ?? null,
            closed_at: row.closed_at ?? null,
            permissions_template_id: row.permissions_template_id ?? null,
            program_id: row.program_id ?? null,
            office_id: row.office_id ?? null,
            project_region_id: row.project_region_id ?? null,
            origin_id: row.origin_id ?? null,
            parent_job_id: row.parent_job_id ?? null,
            project_bid_type_id: row.project_bid_type_id ?? null,
          };

          debugComparison.push({
            id,
            inList,
            inPasses,
            inDedupedV1,
            inV11List: v11Ids.has(id),
            byIdOk: true,
            byIdStatus: 200,
            byIdName: row.name || row.display_name || null,
            byIdProjectNumber: row.project_number || null,
            byIdActive: typeof row.active === 'boolean' ? row.active : null,
            byIdIsDemo: typeof row.is_demo === 'boolean' ? row.is_demo : null,
            byIdStage: row.stage || row.project_stage?.name || null,
            byIdUpdatedAt: row.updated_at || null,
            byIdFlags,
          });
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          const statusMatch = message.match(/\b(4\d\d|5\d\d)\b/);
          const status = statusMatch ? Number.parseInt(statusMatch[1], 10) : 500;
          debugComparison.push({
            id,
            inList,
            inPasses,
            inDedupedV1,
            inV11List: v11Ids.has(id),
            byIdOk: false,
            byIdStatus: status,
            byIdError: message,
          });
        }
      }
    }

    // 2. Fetch all V2 Bid Board Projects.
    // Use the estimating host candidate flow here too, since bid-board coverage can differ by host/token.
    const bidBoardStatusFilter = String(body?.['filters[by_status]'] || body?.bidBoardStatusFilter || 'All').trim() || 'All';
    const requestedEstimatingBaseUrl = String(
      body?.baseUrl || process.env.PROCORE_ESTIMATING_API_URL || DEFAULT_ESTIMATING_BASE_URL
    ).trim();
    const hostCandidates = buildAllowedProcoreHostCandidates({
      requestedOrigin: requestedEstimatingBaseUrl,
      extraOrigins: [process.env.PROCORE_ESTIMATING_API_URL, DEFAULT_ESTIMATING_BASE_URL, 'https://api.procore.com'],
    });

    if (hostCandidates.error) {
      return NextResponse.json({ error: hostCandidates.error }, { status: 400 });
    }

    const fetchBidBoardProjectsForToken = async (token: string) => {
      const merged = new Map<string, Record<string, unknown>>();

      for (const host of hostCandidates.candidates) {
        let page = 1;
        let hostWorked = false;

        while (true) {
          const params = new URLSearchParams({
            page: String(page),
            per_page: '100',
          });
          if (bidBoardStatusFilter) {
            params.set('filters[by_status]', bidBoardStatusFilter);
          }

          const url = `${host.replace(/\/$/, '')}/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects?${params.toString()}`;
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${String(token).trim()}`,
              Accept: 'application/json',
              'Procore-Company-Id': companyId,
            },
          });

          if (!response.ok) {
            const errorBody = await response.text();
            if (response.status === 404) {
              break;
            }
            throw new Error(`Estimating API error ${response.status} from ${host}: ${errorBody}`);
          }

          hostWorked = true;
          const payload = await response.json();
          const items = unwrapBidBoardProjects(payload);
          if (items.length === 0) {
            break;
          }

          for (const item of items) {
            const record = isRecord(item) ? item : {};
            const key = String(
              record.id || `${String(record.project_id || '').trim()}~${String(record.name || '').trim()}~${String(record.status || '').trim()}`
            ).trim();
            if (!key) continue;
            if (!merged.has(key)) {
              merged.set(key, record);
            }
          }

          if (!fetchAll) break;
          page += 1;
          if (page > maxPages) break;
        }

        if (hostWorked && merged.size > 0) {
          break;
        }
      }

      return Array.from(merged.values());
    };

    const bidBoardByKey = new Map<string, Record<string, unknown>>();
    for (const item of await fetchBidBoardProjectsForToken(accessToken)) {
      const record = isRecord(item) ? item : {};
      const key = String(
        record.id || `${String(record.project_id || '').trim()}~${String(record.name || '').trim()}~${String(record.status || '').trim()}`
      ).trim();
      if (!key) continue;
      bidBoardByKey.set(key, item);
    }

    if (userAccessToken && String(userAccessToken).trim() && String(userAccessToken).trim() !== String(accessToken).trim()) {
      for (const item of await fetchBidBoardProjectsForToken(String(userAccessToken).trim())) {
        const record = isRecord(item) ? item : {};
        const key = String(
          record.id || `${String(record.project_id || '').trim()}~${String(record.name || '').trim()}~${String(record.status || '').trim()}`
        ).trim();
        if (!key) continue;
        if (!bidBoardByKey.has(key)) {
          bidBoardByKey.set(key, item);
        }
      }
    }

    // Keep downstream processing permissive because bid-board payloads vary by host/version.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allBidBoardProjects: any[] = Array.from(bidBoardByKey.values());

    // 2.25 Fetch Project Stages (company stage definitions)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allProjectStages: any[] = [];
    let page = 1;
    while (true) {
      const endpoint = `/rest/v1.0/companies/${companyId}/project_stages?page=${page}&per_page=100`;
      const stageData = await makeProcoreRequestWithFallback(endpoint);
      if (!Array.isArray(stageData) || stageData.length === 0) break;
      allProjectStages.push(...stageData);
      if (stageData.length < 100 || !fetchAll) break;
      page++;
      if (page > maxPages) break;
    }

    // 2.5 Fetch vendor map (used as fallback customer resolver)
    const vendorMap: Record<string, string> = {};
    try {
      let vendorPage = 1;
      while (true) {
        const endpoint = `/rest/v1.0/vendors?company_id=${companyId}&page=${vendorPage}&per_page=100`;
        const vendorData = await makeProcoreRequestWithFallback(endpoint);
        if (!Array.isArray(vendorData) || vendorData.length === 0) break;
        for (const vendor of vendorData) {
          if (vendor?.id && vendor?.name) vendorMap[String(vendor.id)] = String(vendor.name);
        }
        if (vendorData.length < 100) break;
        vendorPage++;
        if (vendorPage > 5) break;
      }
    } catch {
      console.warn("Vendor fallback map unavailable for this run.");
    }

    try {
      await ensureEndpointLiveTables();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const isSchemaPermissionError =
        /permission denied for schema public/i.test(message) ||
        /Code:\s*`42501`/i.test(message);

      if (isSchemaPermissionError) {
        // Production DB users can be write-only for existing tables.
        // In that case, continue sync without runtime DDL and rely on migrations.
        console.warn("[Sync] Skipping runtime table/index ensure due to schema permissions.");
      } else {
        throw error;
      }
    }

    console.log(
      `Syncing ${allV1Projects.length} V1 Projects, ${allBidBoardProjects.length} Bid Board items, and ${allProjectStages.length} Project Stages.`
    );

    const results = {
      v1Synced: 0,
      bidBoardSynced: 0,
      pmcProjectsSynced: 0,
      pmcBidBoardProjectsSynced: 0,
      projectStagesSynced: 0,
      stagingSynced: 0,
      stagingBidBoardStatusUpdated: 0,
      stagingBidBoardStatusSkipped: 0,
      errors: [] as string[]
    };

    const v1CustomerByProcoreId = new Map<string, string>();
    const v1CustomerByName = new Map<string, string>();

    function normalizeKey(value: unknown): string {
      return String(value ?? '').trim().toLowerCase();
    }

    function pickCustomerFromUnknown(value: unknown): string {
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        if (typeof obj.name === 'string') return obj.name;
        if (typeof obj.label === 'string') return obj.label;
      }
      return '';
    }

    for (const stage of allProjectStages) {
      try {
        const projectStageId = String(stage.id);
        await upsertProjectStageLive({
          companyId,
          projectStageId,
          name: stage.name || null,
          category: stage.category || null,
          isBiddingStage: typeof stage.is_bidding_stage === 'boolean' ? stage.is_bidding_stage : null,
          defaultStage: typeof stage.default_stage === 'boolean' ? stage.default_stage : null,
          hasChildren: typeof stage.project_stage_has_children === 'boolean' ? stage.project_stage_has_children : null,
          payload: stage,
        });
        results.projectStagesSynced++;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        results.errors.push(`Stage ${String(stage?.name || stage?.id || 'unknown')}: ${message}`);
      }
    }

    // 3. Process V1 Projects (Upsert into 'Project' table)
    // We use customFields to store the Procore ID to avoid breaking existing logic
    // We DO NOT overwrite 'status' if the project is already mapped to a schedule, unless it's new
    for (const p of allV1Projects) {
      try {
        const procoreId = String(p.id);
        const name = p.name || p.display_name || "Untitled Procore Project";
        const number = p.project_number || "";
        
        // Resolve customer name: PRIORITIZE custom field label, fall back to standard fields
        let customer = "";
        const v1CustomFieldCustomer = extractCustomerFromCustomFields(p.custom_fields);
        if (isMeaningfulCustomer(v1CustomFieldCustomer)) {
          customer = v1CustomFieldCustomer;
          console.log(`Resolved project ${name} customer via custom field label: ${customer}`);
        } else {
          customer =
            p.customer_name ||
            pickCustomerFromUnknown(p.customer) ||
            pickCustomerFromUnknown(p.owner) ||
            (p.company && p.company.name) ||
            "";
        }

        // 2. Fallback to vendor map if still blank
        if (!isMeaningfulCustomer(customer) && p.company?.id && vendorMap[String(p.company.id)]) {
          customer = vendorMap[String(p.company.id)];
        }

        if (isMeaningfulCustomer(customer)) {
          v1CustomerByProcoreId.set(procoreId, customer);
          const nameKey = normalizeKey(name);
          if (nameKey) v1CustomerByName.set(nameKey, customer);
        }
        
        // Match by procoreProjectId, projectNumber, or projectName
        const existing = await prisma.project.findFirst({
          where: {
            OR: [
              { procoreId: procoreId },
              { customFields: { path: ['procoreId'], equals: procoreId } },
              { projectNumber: number, projectName: name }
            ]
          }
        });

        const status = p.status || p.project_status?.name || p.project_stage?.name || "Active";
        const statusRaw = p.status || p.project_status?.name || p.project_stage?.name || null;
        const fallbackBidBoardStatus = mapV1StatusToBidBoardStatus(status);

        await upsertProcoreStaging({
          source: "procore_v1_projects",
          companyId,
          externalId: procoreId,
          procoreProjectId: procoreId,
          name,
          status,
          bidBoardStatus: fallbackBidBoardStatus,
          customer: isMeaningfulCustomer(customer) ? customer : null,
          payload: p,
        });
        results.stagingSynced++;

        await upsertPmcProject({
          companyId,
          procoreProjectId: procoreId,
          bidBoardId: null,
          projectNumber: number || null,
          projectName: name,
          customer: isMeaningfulCustomer(customer) ? customer : null,
          status,
          bidBoardStatus: fallbackBidBoardStatus,
          projectManager: typeof p.project_manager === "string" ? p.project_manager : null,
          estimator: typeof p.project_estimator === "string" ? p.project_estimator : null,
          address: typeof p.address === "string" ? p.address : null,
          city: typeof p.city === "string" ? p.city : null,
          state: typeof p.state_code === "string" ? p.state_code : null,
          zip: typeof p.zip === "string" ? p.zip : null,
          procoreCreatedAt: p.created_at ? new Date(String(p.created_at)) : null,
          procoreUpdatedAt: p.updated_at ? new Date(String(p.updated_at)) : null,
        });
        results.pmcProjectsSynced++;

        if (existing) {
          const existingCustomFields =
            existing.customFields && typeof existing.customFields === 'object' && !Array.isArray(existing.customFields)
              ? (existing.customFields as Record<string, unknown>)
              : {};

          const canonicalStatus = fallbackBidBoardStatus || existing.status;
          const canonicalStatusSource = fallbackBidBoardStatus ? 'procore_v1_mapped' : existing.statusSource;

          await prisma.project.update({
            where: { id: existing.id },
            data: {
              // procoreProjectId: procoreId,
              // procoreLastSync: new Date(),
              procoreId,
              // Only fill if current values are empty or a default "Unknown" placeholder
              projectNumber: existing.projectNumber || number,
              customer: isMeaningfulCustomer(customer)
                ? customer
                : (existing.customer || customer || null),
              status: canonicalStatus,
              customerSource: isMeaningfulCustomer(customer)
                ? 'procore_v1'
                : (existing.customerSource || null),
              statusSource: canonicalStatusSource,
              customFields: {
                ...existingCustomFields,
                procoreId: procoreId, // Storing in JSON instead of new column for now
                customerLabel: isMeaningfulCustomer(customer)
                  ? customer
                  : ((existingCustomFields.customerLabel as string | null | undefined) || null),
                statusRaw,
                bidBoardStatus: fallbackBidBoardStatus,
                statusSyncedAt: new Date().toISOString(),
                syncedFrom: 'procore_v1',
                syncedAt: new Date().toISOString()
              }
            }
          });
        } else {
          await prisma.project.create({
            data: {
              projectName: name,
              procoreId,
              projectNumber: number,
              customer: isMeaningfulCustomer(customer) ? customer : null,
              customerSource: isMeaningfulCustomer(customer) ? 'procore_v1' : null,
              status: fallbackBidBoardStatus,
              statusSource: fallbackBidBoardStatus ? 'procore_v1_mapped' : null,
              // procoreProjectId: procoreId,
              customFields: { 
                procoreId: procoreId,
                customerLabel: isMeaningfulCustomer(customer) ? customer : null,
                bidBoardStatus: fallbackBidBoardStatus,
                statusRaw,
                source: 'procore_v1',
                syncedAt: new Date().toISOString()
              }
            }
          });
        }
        results.v1Synced++;
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        results.errors.push(`V1 ${p.name}: ${message}`);
      }
    }

    // 4. Process Bid Board Projects
    for (const bb of allBidBoardProjects) {
      try {
        const bidId = String(bb.id);
        const procoreProjectId = bb.project_id ? String(bb.project_id) : null;
        const name = bb.name || "Untitled Bid";
        const bidStatus = normalizeBidBoardStatus(bb.status) || "Bid Submitted";
        const bidStatusRaw = bb.status || null;
        
        // Resolve customer: PRIORITIZE custom field label over standard fields
        let customer = "";
        const bbCustomFieldCustomer = extractCustomerFromCustomFields(bb.custom_fields) 
          || extractCustomerFromCustomFields(bb.raw?.custom_fields);
        
        if (isMeaningfulCustomer(bbCustomFieldCustomer)) {
          customer = bbCustomFieldCustomer;
          console.log(`Resolved bid ${name} customer via custom field label: ${customer}`);
        } else {
          customer =
            bb.customer_name ||
            pickCustomerFromUnknown(bb.customer_company) ||
            bb.client?.name ||
            bb.company?.name ||
            pickCustomerFromUnknown(bb.raw?.customer_company) ||
            (bb.raw && bb.raw.client && bb.raw.client.name) || 
            (bb.raw && bb.raw.company && bb.raw.company.name) || 
            (bb.raw && bb.raw.customer_name) || "";
        }
        
        // Fallback to vendor map if still blank
        if (!isMeaningfulCustomer(customer) && bb.client?.id && vendorMap[String(bb.client.id)]) {
          customer = vendorMap[String(bb.client.id)];
        }
        if (!isMeaningfulCustomer(customer) && bb.company?.id && vendorMap[String(bb.company.id)]) {
          customer = vendorMap[String(bb.company.id)];
        }
        if (!isMeaningfulCustomer(customer) && bb.raw?.client?.id && vendorMap[String(bb.raw.client.id)]) {
          customer = vendorMap[String(bb.raw.client.id)];
        }
        if (!isMeaningfulCustomer(customer) && bb.raw?.company?.id && vendorMap[String(bb.raw.company.id)]) {
          customer = vendorMap[String(bb.raw.company.id)];
        }

        if (!isMeaningfulCustomer(customer) && procoreProjectId && v1CustomerByProcoreId.has(procoreProjectId)) {
          customer = v1CustomerByProcoreId.get(procoreProjectId) || '';
        }

        if (!isMeaningfulCustomer(customer)) {
          const nameKey = normalizeKey(name);
          if (nameKey && v1CustomerByName.has(nameKey)) {
            customer = v1CustomerByName.get(nameKey) || '';
          }
        }

        await upsertBidBoardLive({
          companyId,
          bidBoardId: bidId,
          procoreProjectId,
          name,
          status: bidStatus,
          statusRaw: bidStatusRaw,
          customer: isMeaningfulCustomer(customer) ? customer : null,
          payload: bb,
        });

        await upsertPmcBidBoardProject({
          companyId,
          bidBoardId: bidId,
          procoreProjectId,
          projectNumber: typeof bb.project_number === 'string' ? bb.project_number : null,
          projectName: name,
          customer: isMeaningfulCustomer(customer) ? customer : null,
          customerCompanyId: bb.customer_company?.id ? String(bb.customer_company.id) : null,
          status: bidStatus,
          statusRaw: bidStatusRaw,
          payload: bb,
        });
        results.pmcBidBoardProjectsSynced++;

        // Match by customFields path instead of new columns
        const existing = await prisma.project.findFirst({
          where: {
            OR: [
              { bidBoardId: bidId },
              { customFields: { path: ['bidBoardId'], equals: bidId } },
              ...(procoreProjectId ? [{ procoreId: procoreProjectId }] : []),
              ...(procoreProjectId ? [{ customFields: { path: ['procoreId'], equals: procoreProjectId } }] : [])
            ]
          }
        });

        if (existing) {
          const existingCustomFields =
            existing.customFields && typeof existing.customFields === 'object' && !Array.isArray(existing.customFields)
              ? (existing.customFields as Record<string, unknown>)
              : {};

          await prisma.project.update({
            where: { id: existing.id },
            data: {
              bidBoardId: bidId,
              procoreId: procoreProjectId || existing.procoreId,
              customer: isMeaningfulCustomer(customer) ? customer : (existing.customer || null),
              status: bidStatus,
              customerSource: isMeaningfulCustomer(customer)
                ? 'procore_bid_board'
                : (existing.customerSource || null),
              statusSource: 'procore_bid_board',
              customFields: {
                ...existingCustomFields,
                bidBoardId: bidId,
                procoreId: procoreProjectId || (existingCustomFields.procoreId as string | null | undefined),
                customerLabel: isMeaningfulCustomer(customer)
                  ? customer
                  : ((existingCustomFields.customerLabel as string | null | undefined) || null),
                bidBoardStatus: bidStatus,
                bidBoardStatusRaw: bidStatusRaw,
                statusSyncedAt: new Date().toISOString(),
                syncedAt: new Date().toISOString()
              }
            }
          });
        } else {
          await prisma.project.create({
            data: {
              projectName: name,
              bidBoardId: bidId,
              procoreId: procoreProjectId,
              customer: isMeaningfulCustomer(customer) ? customer : null,
              customerSource: isMeaningfulCustomer(customer) ? 'procore_bid_board' : null,
              status: bidStatus,
              statusSource: 'procore_bid_board',
              customFields: {
                bidBoardId: bidId,
                procoreId: procoreProjectId,
                bidBoardStatus: bidStatus,
                bidBoardStatusRaw: bidStatusRaw,
                customerLabel: isMeaningfulCustomer(customer) ? customer : null,
                source: 'procore_bid_board',
                syncedAt: new Date().toISOString()
              }
            }
          });
        }
        results.bidBoardSynced++;

        const updatedStagingRows = await applyBidBoardStatusToV1Staging({
          companyId,
          procoreProjectId,
          bidBoardStatus: bidStatus,
          bidBoardId: bidId,
          bidBoardName: name,
          customer: isMeaningfulCustomer(customer) ? customer : null,
        });

        if (updatedStagingRows > 0) {
          results.stagingBidBoardStatusUpdated += updatedStagingRows;
          results.stagingSynced += updatedStagingRows;
        } else {
          results.stagingBidBoardStatusSkipped++;
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        results.errors.push(`Bid ${bb.name}: ${message}`);
      }
    }

    return NextResponse.json({
      success: true,
      tokenSource,
      bidBoardStatusFilter,
      summary: results,
      primeProjectBackfill: primeBackfillStats,
      debug: debugProjectIds.length > 0 ? {
        requestedIds: debugProjectIds,
        comparison: debugComparison,
      } : undefined,
    });

    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ error: message }, { status: 500 });
    }
  });
}

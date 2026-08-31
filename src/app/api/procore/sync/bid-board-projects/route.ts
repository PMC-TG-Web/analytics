import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  getClientCredentialsToken,
  hasValidProcoreSyncSecret,
  withProcoreLiveApiBypassForSyncSecret,
} from "@/lib/procore";
import { prisma } from "@/lib/prisma";
import { extractCustomerFromCustomFields, isMeaningfulCustomer } from "@/lib/procoreProjectFeed";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";
import { shouldStopBidBoardPagination } from "@/lib/procoreBidBoardPagination";
import { bidBoardPayloadChanged } from "@/lib/procoreBidBoardChange";
import { assessBidBoardCoverage } from "@/lib/procoreBidBoardCoverage";
import { queueEstimatingSyncProjects } from "@/lib/procoreSyncQueue";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_ESTIMATING_BASE_URL = "https://api.procore.com";
const ESTIMATING_DATASET = "nightly_estimates";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asProjects(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];
  for (const value of [payload.data, payload.projects, payload.bid_board_projects]) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

function nestedText(value: unknown, ...keys: string[]): string {
  if (!isRecord(value)) return "";
  for (const key of keys) {
    const result = text(value[key]);
    if (result) return result;
  }
  return "";
}

function normalizeBidBoardStatus(status: unknown): string | null {
  const normalized = text(status)
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
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function customerFromProject(project: UnknownRecord): string | null {
  const raw = isRecord(project.raw) ? project.raw : {};
  const customFieldCustomer =
    extractCustomerFromCustomFields(project.custom_fields)
    || extractCustomerFromCustomFields(raw.custom_fields);
  const candidates = [
    customFieldCustomer,
    text(project.customer_name),
    nestedText(project.customer_company, "name", "label"),
    nestedText(project.client, "name", "label"),
    nestedText(project.company, "name", "label"),
    nestedText(raw.customer_company, "name", "label"),
    nestedText(raw.client, "name", "label"),
    nestedText(raw.company, "name", "label"),
    text(raw.customer_name),
  ];
  return candidates.find((candidate) => isMeaningfulCustomer(candidate)) || null;
}

function projectIsActive(project: UnknownRecord): boolean {
  return !Boolean(project.archived || project.deleted || project.is_template);
}

function numeric(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function fetchAllBidBoardProjects(params: {
  companyId: string;
  accessToken: string;
  baseUrl?: unknown;
}) {
  const hostCandidates = buildAllowedProcoreHostCandidates({
    requestedOrigin: params.baseUrl,
    extraOrigins: [process.env.PROCORE_ESTIMATING_API_URL, DEFAULT_ESTIMATING_BASE_URL],
  });
  if (hostCandidates.error) {
    throw Object.assign(new Error(hostCandidates.error), { status: 400 });
  }

  let lastError: Error & { status?: number; responseHeaders?: Headers } | null = null;
  for (const host of hostCandidates.candidates) {
    const projects = new Map<string, UnknownRecord>();
    let hostWorked = false;
    let pagesFetched = 0;
    for (let page = 1; page <= 20; page += 1) {
      const search = new URLSearchParams({
        page: String(page),
        per_page: "100",
        "filters[by_status]": "All",
      });
      const response = await fetch(
        `${host}/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/estimating/bid_board_projects?${search}`,
        {
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            Accept: "application/json",
            "Procore-Company-Id": params.companyId,
          },
          signal: AbortSignal.timeout(90_000),
        }
      );
      if (!response.ok) {
        const detail = await response.text();
        if (response.status === 404) break;
        lastError = Object.assign(
          new Error(`Procore Bid Board request failed (${response.status}): ${detail.slice(0, 2_000)}`),
          { status: response.status, responseHeaders: response.headers }
        );
        break;
      }

      hostWorked = true;
      pagesFetched = page;
      const pageProjects = asProjects(await response.json());
      let newProjectCount = 0;
      for (const value of pageProjects) {
        if (!isRecord(value)) continue;
        const id = text(value.id || value.bid_board_project_id);
        if (!id) continue;
        if (!projects.has(id)) newProjectCount += 1;
        projects.set(id, value);
      }
      // Procore can return a short page before the final page. Continue until
      // it returns no rows (or repeats a page without adding any new IDs).
      if (shouldStopBidBoardPagination({
        pageItemCount: pageProjects.length,
        newProjectCount,
      })) break;
    }
    if (hostWorked && projects.size > 0) {
      return { host, projects: Array.from(projects.values()), pagesFetched };
    }
    if (lastError?.status === 429) throw lastError;
  }

  throw lastError || Object.assign(new Error("Procore returned no Bid Board projects."), { status: 502 });
}

async function resolveProcoreProjectId(params: {
  companyId: string;
  projectNumber: string | null;
  suppliedProjectId: string | null;
}) {
  if (params.suppliedProjectId) return params.suppliedProjectId;
  if (!params.projectNumber) return null;

  const matches = await prisma.$queryRawUnsafe<Array<{ procore_project_id: string }>>(
    `
      SELECT procore_project_id
      FROM pmc_projects
      WHERE company_id = $1
        AND LOWER(BTRIM(project_number)) = LOWER(BTRIM($2))
      ORDER BY updated_at DESC
      LIMIT 2
    `,
    params.companyId,
    params.projectNumber
  );

  return matches.length === 1 ? matches[0].procore_project_id : null;
}

async function upsertProject(params: {
  companyId: string;
  project: UnknownRecord;
  previousPayload?: unknown;
  hasEstimateQueueRecord: boolean;
}) {
  const { companyId, project, previousPayload, hasEstimateQueueRecord } = params;
  const bidBoardId = text(project.id || project.bid_board_project_id);
  if (!bidBoardId) return null;
  const raw = isRecord(project.raw) ? project.raw : {};
  const projectNumber = text(project.project_number) || null;
  const procoreProjectId = await resolveProcoreProjectId({
    companyId,
    projectNumber,
    suppliedProjectId: text(project.project_id || project.procore_project_id) || null,
  });
  const projectName = text(project.name || project.title) || "Untitled Bid";
  const customer = customerFromProject(project);
  const customerCompanyId =
    nestedText(project.customer_company, "id")
    || nestedText(raw.customer_company, "id")
    || null;
  const statusRaw = text(project.status) || null;
  const status = normalizeBidBoardStatus(statusRaw) || "Bid Submitted";
  const payload = jsonValue(project);

  await Promise.all([
    prisma.pmcBidBoardProject.upsert({
      where: { companyId_bidBoardId: { companyId, bidBoardId } },
      create: {
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
        syncedAt: new Date(),
      },
      update: {
        ...(procoreProjectId ? { procoreProjectId } : {}),
        projectNumber,
        projectName,
        customer,
        customerCompanyId,
        status,
        statusRaw,
        payload,
        syncedAt: new Date(),
      },
    }),
    prisma.$executeRawUnsafe(
      `
        INSERT INTO procore_bid_board_live (
          bid_board_id, company_id, procore_project_id, name, status,
          status_raw, customer, payload, synced_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
        ON CONFLICT (bid_board_id)
        DO UPDATE SET
          company_id = EXCLUDED.company_id,
          procore_project_id = COALESCE(EXCLUDED.procore_project_id, procore_bid_board_live.procore_project_id),
          name = EXCLUDED.name,
          status = EXCLUDED.status,
          status_raw = EXCLUDED.status_raw,
          customer = EXCLUDED.customer,
          payload = EXCLUDED.payload,
          synced_at = NOW()
      `,
      bidBoardId,
      companyId,
      procoreProjectId,
      projectName,
      status,
      statusRaw,
      customer,
      JSON.stringify(project)
    ),
    ...(procoreProjectId
      ? [
          prisma.pmcProject.updateMany({
            where: { companyId, procoreProjectId },
            data: {
              bidBoardId,
              bidBoardStatus: status,
              syncedAt: new Date(),
            },
          }),
        ]
      : []),
  ]);

  return {
    bidBoardId,
    status,
    sales: numeric(isRecord(project.stats) ? project.stats.total : 0),
    active: projectIsActive(project),
    estimateDetailsDue: !hasEstimateQueueRecord || bidBoardPayloadChanged(previousPayload, project),
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T) => Promise<R>
) {
  const results: R[] = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(values[index]);
    }
  }));
  return results;
}

async function markMissingCurrentRows(companyId: string, currentIds: string[]) {
  const coverageRows = await prisma.$queryRawUnsafe<Array<{
    existing_current_rows: number;
    expected_visible_rows: number;
    known_missing_rows: number;
  }>>(
    `
      SELECT
        COUNT(*)::int AS existing_current_rows,
        COUNT(*) FILTER (
          WHERE COALESCE((payload->>'sync_missing_from_procore')::boolean, false) = false
        )::int AS expected_visible_rows,
        COUNT(*) FILTER (
          WHERE COALESCE((payload->>'sync_missing_from_procore')::boolean, false) = true
        )::int AS known_missing_rows
      FROM pmc_bid_board_projects
      WHERE company_id = $1
        AND POSITION(':' IN bid_board_id) = 0
    `,
    companyId
  );
  const existingCurrentRows = Number(coverageRows[0]?.existing_current_rows || 0);
  const expectedVisibleRows = Number(coverageRows[0]?.expected_visible_rows || 0);
  const knownMissingRows = Number(coverageRows[0]?.known_missing_rows || 0);
  const coverageAssessment = assessBidBoardCoverage({
    fetchedRows: currentIds.length,
    expectedVisibleRows,
  });
  // Estimating visibility can differ between a user's Procore session and the
  // service account. Never mark rows stale from a materially incomplete list.
  // Rows already confirmed missing are historical evidence, not records the
  // service account is still expected to return, so exclude them from the
  // coverage denominator.
  if (!coverageAssessment.complete) {
    return {
      pmc: 0,
      live: 0,
      skipped: true,
      reason: !currentIds.length ? "empty_response" : "incomplete_service_account_coverage",
      fetched: currentIds.length,
      existingCurrentRows,
      expectedVisibleRows,
      knownMissingRows,
      coverage: coverageAssessment.coverage,
    };
  }
  const [pmc, live] = await Promise.all([
    prisma.$executeRawUnsafe(
      `
        UPDATE pmc_bid_board_projects
        SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
              'sync_missing_from_procore', true,
              'sync_missing_at', NOW()::text
            ),
            synced_at = NOW(),
            updated_at = NOW()
        WHERE company_id = $1
          AND POSITION(':' IN bid_board_id) = 0
          AND NOT (bid_board_id = ANY($2::text[]))
          AND COALESCE((payload->>'sync_missing_from_procore')::boolean, false) = false
      `,
      companyId,
      currentIds
    ),
    prisma.$executeRawUnsafe(
      `
        UPDATE procore_bid_board_live
        SET payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
              'sync_missing_from_procore', true,
              'sync_missing_at', NOW()::text
            ),
            synced_at = NOW()
        WHERE company_id = $1
          AND POSITION(':' IN bid_board_id) = 0
          AND NOT (bid_board_id = ANY($2::text[]))
          AND COALESCE((payload->>'sync_missing_from_procore')::boolean, false) = false
      `,
      companyId,
      currentIds
    ),
  ]);
  return {
    pmc,
    live,
    skipped: false,
    reason: null,
    fetched: currentIds.length,
    existingCurrentRows,
    expectedVisibleRows,
    knownMissingRows,
    coverage: coverageAssessment.coverage,
  };
}

export async function POST(request: Request) {
  if (!hasValidProcoreSyncSecret(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  return withProcoreLiveApiBypassForSyncSecret(request, async () => {
    try {
      const body = await request.json().catch(() => ({}));
      const companyId = text(body.companyId || process.env.PROCORE_COMPANY_ID);
      if (!companyId) {
        return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
      }

      const accessToken = await getClientCredentialsToken();
      const fetched = await fetchAllBidBoardProjects({
        companyId,
        accessToken,
        baseUrl: body.baseUrl || process.env.PROCORE_ESTIMATING_API_URL || DEFAULT_ESTIMATING_BASE_URL,
      });
      const fetchedIds = fetched.projects
        .map((project) => isRecord(project) ? text(project.id || project.bid_board_project_id) : "")
        .filter(Boolean);
      const [existingProjects, existingEstimateQueue] = await Promise.all([
        prisma.pmcBidBoardProject.findMany({
          where: { companyId, bidBoardId: { in: fetchedIds } },
          select: { bidBoardId: true, payload: true },
        }),
        prisma.procoreSyncProjectState.findMany({
          where: {
            companyId,
            dataset: ESTIMATING_DATASET,
            projectId: { in: fetchedIds },
          },
          select: { projectId: true },
        }),
      ]);
      const previousPayloadById = new Map(
        existingProjects.map((project) => [project.bidBoardId, project.payload]),
      );
      const queuedEstimateIds = new Set(existingEstimateQueue.map((state) => state.projectId));

      const persisted = (await mapWithConcurrency(fetched.projects, 8, (project) => {
        const bidBoardId = isRecord(project) ? text(project.id || project.bid_board_project_id) : "";
        return upsertProject({
          companyId,
          project: isRecord(project) ? project : {},
          previousPayload: previousPayloadById.get(bidBoardId),
          hasEstimateQueueRecord: queuedEstimateIds.has(bidBoardId),
        });
      }))
        .filter((value): value is NonNullable<typeof value> => Boolean(value));
      const estimateDetailsDue = persisted
        .filter((project) => project.active && project.estimateDetailsDue)
        .map((project) => project.bidBoardId);
      const estimateDetailsQueued = await queueEstimatingSyncProjects(
        companyId,
        ESTIMATING_DATASET,
        estimateDetailsDue,
      );
      const currentIds = persisted.map((project) => project.bidBoardId);
      const markedMissing = await markMissingCurrentRows(companyId, currentIds);
      const completeCoverage = !markedMissing.skipped;

      const statusGroups: Record<string, { count: number; sales: number }> = {};
      for (const project of persisted) {
        if (!project.active) continue;
        const group = statusGroups[project.status] || { count: 0, sales: 0 };
        group.count += 1;
        group.sales += project.sales;
        statusGroups[project.status] = group;
      }

      return NextResponse.json({
        success: completeCoverage,
        partialCoverage: !completeCoverage,
        companyId,
        host: fetched.host,
        pagesFetched: fetched.pagesFetched,
        fetched: fetched.projects.length,
        persisted: persisted.length,
        estimateDetailsQueued,
        estimateDetailProjectIds: estimateDetailsDue,
        markedMissing,
        statusGroups,
      }, { status: completeCoverage ? 200 : 206 });
    } catch (error) {
      const typed = error as Error & { status?: number; responseHeaders?: Headers };
      const status = typed.status && typed.status >= 400 && typed.status <= 599 ? typed.status : 500;
      const headers = new Headers();
      for (const name of ["retry-after", "x-rate-limit-reset", "x-ratelimit-remaining"]) {
        const value = typed.responseHeaders?.get(name);
        if (value) headers.set(name, value);
      }
      return NextResponse.json(
        { success: false, error: typed.message || String(error) },
        { status, headers }
      );
    }
  });
}

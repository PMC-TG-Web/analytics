import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";
import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";

const DEFAULT_ESTIMATING_BASE_URL = "https://api.procore.com";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function asArray(payload: unknown, keys: string[] = []): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];

  const defaultKeys = ["data", "items", "results"];
  const candidates = [...keys, ...defaultKeys];
  for (const key of candidates) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function isMissingTableError(error: unknown): boolean {
  const code = String((error as { code?: string })?.code || "").toUpperCase();
  const message = error instanceof Error ? error.message : String(error);
  return code === "42P01" || /relation .* does not exist/i.test(message);
}

async function assertProposalLineItemsLiveTableExists() {
  await prisma.$queryRawUnsafe(`SELECT 1 FROM procore_proposal_line_items_live LIMIT 1`);
  await prisma.$queryRawUnsafe(`SELECT 1 FROM procore_estimate_proposals LIMIT 1`);
  await prisma.$queryRawUnsafe(`SELECT 1 FROM procore_estimate_line_items LIMIT 1`);
}

function readText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeTimestamp(value: unknown): string | null {
  const text = readText(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function nestedObject(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = readText(value);
    if (text) return text;
  }
  return null;
}

function isBaselineProposalName(name: string | null): boolean {
  if (!name) return false;
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return normalized === "original estimate" || normalized === "base estimate" || normalized === "baseline estimate";
}

function laborHoursForLine(lineItem: UnknownRecord): number | null {
  const costItem = nestedObject(lineItem.cost_item);
  const unit = firstText(costItem.unit, costItem.uom, lineItem.unit, lineItem.uom)?.toUpperCase();
  if (!unit || !["HOUR", "HOURS", "HR", "HRS"].includes(unit)) return null;
  return readNumber(lineItem.count ?? lineItem.quantity);
}

async function resolveProcoreProjectId(
  companyId: string,
  bidBoardProjectId: string,
  projectRecord: UnknownRecord
): Promise<string | null> {
  const direct = firstText(
    projectRecord.procore_project_id,
    projectRecord.project_id,
    nestedObject(projectRecord.project).id
  );
  if (direct) return direct;

  const rows = await prisma.$queryRawUnsafe<Array<{ procore_project_id: string | null }>>(
    `
      SELECT procore_project_id
      FROM pmc_bid_board_projects
      WHERE company_id = $1 AND bid_board_id = $2
      LIMIT 1
    `,
    companyId,
    bidBoardProjectId
  );
  return readText(rows[0]?.procore_project_id);
}

async function upsertEstimateProposal(params: {
  companyId: string;
  bidBoardProjectId: string;
  procoreProjectId: string | null;
  projectName: string | null;
  customerName: string | null;
  proposalId: string;
  proposalName: string | null;
  proposal: UnknownRecord;
}) {
  const {
    companyId,
    bidBoardProjectId,
    procoreProjectId,
    projectName,
    customerName,
    proposalId,
    proposalName,
    proposal,
  } = params;
  const status = firstText(proposal.status, proposal.state);
  const sourceUpdatedAt = normalizeTimestamp(proposal.updated_at);

  await prisma.$executeRawUnsafe(
    `
      INSERT INTO procore_estimate_proposals (
        company_id, bid_board_project_id, proposal_id, procore_project_id,
        project_name, customer_name, proposal_name, status,
        is_baseline_candidate, payload, source_updated_at, synced_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::timestamptz, NOW(), NOW())
      ON CONFLICT (company_id, bid_board_project_id, proposal_id)
      DO UPDATE SET
        procore_project_id = EXCLUDED.procore_project_id,
        project_name = EXCLUDED.project_name,
        customer_name = EXCLUDED.customer_name,
        proposal_name = EXCLUDED.proposal_name,
        status = EXCLUDED.status,
        is_baseline_candidate = EXCLUDED.is_baseline_candidate,
        payload = EXCLUDED.payload,
        source_updated_at = EXCLUDED.source_updated_at,
        synced_at = NOW(),
        updated_at = NOW()
    `,
    companyId,
    bidBoardProjectId,
    proposalId,
    procoreProjectId,
    projectName,
    customerName,
    proposalName,
    status,
    isBaselineProposalName(proposalName),
    JSON.stringify(proposal),
    sourceUpdatedAt
  );
}

async function reconcileNormalizedEstimateLines(params: {
  companyId: string;
  bidBoardProjectId: string;
  proposalId: string;
  lineItemIds: string[];
}) {
  const { companyId, bidBoardProjectId, proposalId, lineItemIds } = params;
  await prisma.$executeRawUnsafe(
    `
      DELETE FROM procore_estimate_line_items
      WHERE company_id = $1
        AND bid_board_project_id = $2
        AND proposal_id = $3
        AND NOT (line_item_id = ANY($4::text[]))
    `,
    companyId,
    bidBoardProjectId,
    proposalId,
    lineItemIds
  );
}

async function reconcileEstimateProposals(params: {
  companyId: string;
  bidBoardProjectId: string;
  proposalIds: string[];
}) {
  const { companyId, bidBoardProjectId, proposalIds } = params;
  const staleRows = await prisma.$queryRawUnsafe<Array<{ proposal_id: string }>>(
    `
      SELECT DISTINCT proposal_id
      FROM (
        SELECT proposal_id FROM procore_estimate_proposals
        WHERE company_id = $1 AND bid_board_project_id = $2
        UNION
        SELECT proposal_id FROM procore_estimate_line_items
        WHERE company_id = $1 AND bid_board_project_id = $2
        UNION
        SELECT proposal_id FROM procore_proposal_line_items_live
        WHERE company_id = $1 AND bid_board_project_id = $2
      ) stored
      WHERE NOT (proposal_id = ANY($3::text[]))
    `,
    companyId,
    bidBoardProjectId,
    proposalIds
  );
  const staleProposalIds = staleRows.map((row) => row.proposal_id).filter(Boolean);
  if (staleProposalIds.length === 0) return 0;

  await Promise.all([
    prisma.$executeRawUnsafe(
      `DELETE FROM procore_estimate_line_items WHERE company_id = $1 AND bid_board_project_id = $2 AND proposal_id = ANY($3::text[])`,
      companyId,
      bidBoardProjectId,
      staleProposalIds
    ),
    prisma.$executeRawUnsafe(
      `DELETE FROM procore_proposal_line_items_live WHERE company_id = $1 AND bid_board_project_id = $2 AND proposal_id = ANY($3::text[])`,
      companyId,
      bidBoardProjectId,
      staleProposalIds
    ),
    prisma.$executeRawUnsafe(
      `DELETE FROM procore_estimate_proposals WHERE company_id = $1 AND bid_board_project_id = $2 AND proposal_id = ANY($3::text[])`,
      companyId,
      bidBoardProjectId,
      staleProposalIds
    ),
  ]);
  return staleProposalIds.length;
}

function getLineItemId(lineItem: unknown, bidBoardProjectId: string, proposalId: string): string {
  if (isRecord(lineItem)) {
    const directId = String(lineItem.id || lineItem.line_item_id || "").trim();
    if (directId) return directId;
  }

  const fallbackSeed = `${bidBoardProjectId}:${proposalId}:${JSON.stringify(lineItem)}`;
  return createHash("sha256").update(fallbackSeed).digest("hex");
}

async function upsertProposalLineItemsBatch(params: {
  companyId: string;
  bidBoardProjectId: string;
  proposalId: string;
  procoreProjectId: string | null;
  projectName: string | null;
  customerName: string | null;
  proposalName: string | null;
  lineItems: unknown[];
}) {
  if (params.lineItems.length === 0) return [];

  const rows = params.lineItems.map((lineItem) => {
    const item = isRecord(lineItem) ? lineItem : {};
    const costItem = nestedObject(item.cost_item);
    const costCodeObject = nestedObject(item.cost_code);
    const costItemCostCode = nestedObject(costItem.cost_code);
    const budgetCode = nestedObject(item.budget_code);
    const group = nestedObject(item.group);
    const lineItemId = getLineItemId(lineItem, params.bidBoardProjectId, params.proposalId);
    const costCode = firstText(
      costCodeObject.full_code,
      costCodeObject.code,
      costItemCostCode.full_code,
      costItemCostCode.code,
      budgetCode.flat_code,
      item.cost_code
    );

    return {
      company_id: params.companyId,
      bid_board_project_id: params.bidBoardProjectId,
      proposal_id: params.proposalId,
      line_item_id: lineItemId,
      procore_project_id: params.procoreProjectId,
      project_name: params.projectName,
      customer_name: params.customerName,
      proposal_name: params.proposalName,
      group_id: firstText(item.group_id, group.id),
      group_name: firstText(item.group_name, item.group_title, group.name, group.title),
      name: firstText(item.name, item.description, item.title),
      status: firstText(item.status),
      cost_code_id: firstText(costCodeObject.id, costItemCostCode.id, budgetCode.cost_code_id),
      cost_code: costCode,
      live_cost_code: isRecord(item.cost_code)
        ? firstText(item.cost_code.code, item.cost_code.name)
        : firstText(item.cost_code),
      wbs_code: firstText(item.wbs_code, budgetCode.flat_code, costCode),
      cost_item_id: firstText(costItem.id, item.cost_item_id),
      uom: firstText(costItem.unit, costItem.uom, item.unit, item.uom),
      quantity: readNumber(item.count ?? item.quantity),
      labor_factor: readNumber(item.labor_factor),
      item_cost: readNumber(item.item_cost),
      item_sales: readNumber(item.item_sales),
      labor_cost: readNumber(item.labor_cost),
      labor_sales: readNumber(item.labor_sales),
      labor_hours: laborHoursForLine(item),
      payload: lineItem ?? {},
      source_updated_at: normalizeTimestamp(item.updated_at),
    };
  });
  const payload = JSON.stringify(rows);

  await prisma.$transaction([
    prisma.$executeRawUnsafe(
      `
        INSERT INTO procore_proposal_line_items_live (
          company_id, bid_board_project_id, proposal_id, line_item_id,
          project_name, customer_name, proposal_name, name, status, cost_code,
          payload, synced_at, updated_at
        )
        SELECT
          company_id, bid_board_project_id, proposal_id, line_item_id,
          project_name, customer_name, proposal_name, name, status, live_cost_code,
          payload, NOW(), NOW()
        FROM jsonb_to_recordset($1::jsonb) AS row(
          company_id text, bid_board_project_id text, proposal_id text, line_item_id text,
          procore_project_id text, project_name text, customer_name text, proposal_name text,
          group_id text, group_name text, name text, status text, cost_code_id text,
          cost_code text, live_cost_code text, wbs_code text, cost_item_id text, uom text,
          quantity numeric, labor_factor numeric, item_cost numeric, item_sales numeric,
          labor_cost numeric, labor_sales numeric, labor_hours numeric,
          payload jsonb, source_updated_at timestamptz
        )
        ON CONFLICT (company_id, bid_board_project_id, proposal_id, line_item_id)
        DO UPDATE SET
          project_name = EXCLUDED.project_name,
          customer_name = EXCLUDED.customer_name,
          proposal_name = EXCLUDED.proposal_name,
          name = EXCLUDED.name,
          status = EXCLUDED.status,
          cost_code = EXCLUDED.cost_code,
          payload = EXCLUDED.payload,
          synced_at = NOW(),
          updated_at = NOW()
      `,
      payload
    ),
    prisma.$executeRawUnsafe(
      `
        INSERT INTO procore_estimate_line_items (
          company_id, bid_board_project_id, proposal_id, line_item_id, procore_project_id,
          group_id, group_name, name, status, cost_code_id, cost_code, wbs_code,
          cost_item_id, uom, quantity, labor_factor, item_cost, item_sales,
          labor_cost, labor_sales, labor_hours, payload, source_updated_at,
          synced_at, updated_at
        )
        SELECT
          company_id, bid_board_project_id, proposal_id, line_item_id, procore_project_id,
          group_id, group_name, name, status, cost_code_id, cost_code, wbs_code,
          cost_item_id, uom, quantity, labor_factor, item_cost, item_sales,
          labor_cost, labor_sales, labor_hours, payload, source_updated_at,
          NOW(), NOW()
        FROM jsonb_to_recordset($1::jsonb) AS row(
          company_id text, bid_board_project_id text, proposal_id text, line_item_id text,
          procore_project_id text, project_name text, customer_name text, proposal_name text,
          group_id text, group_name text, name text, status text, cost_code_id text,
          cost_code text, wbs_code text, cost_item_id text, uom text,
          quantity numeric, labor_factor numeric, item_cost numeric, item_sales numeric,
          labor_cost numeric, labor_sales numeric, labor_hours numeric,
          payload jsonb, source_updated_at timestamptz
        )
        ON CONFLICT (company_id, bid_board_project_id, proposal_id, line_item_id)
        DO UPDATE SET
          procore_project_id = EXCLUDED.procore_project_id,
          group_id = EXCLUDED.group_id,
          group_name = EXCLUDED.group_name,
          name = EXCLUDED.name,
          status = EXCLUDED.status,
          cost_code_id = EXCLUDED.cost_code_id,
          cost_code = EXCLUDED.cost_code,
          wbs_code = EXCLUDED.wbs_code,
          cost_item_id = EXCLUDED.cost_item_id,
          uom = EXCLUDED.uom,
          quantity = EXCLUDED.quantity,
          labor_factor = EXCLUDED.labor_factor,
          item_cost = EXCLUDED.item_cost,
          item_sales = EXCLUDED.item_sales,
          labor_cost = EXCLUDED.labor_cost,
          labor_sales = EXCLUDED.labor_sales,
          labor_hours = EXCLUDED.labor_hours,
          payload = EXCLUDED.payload,
          source_updated_at = EXCLUDED.source_updated_at,
          synced_at = NOW(),
          updated_at = NOW()
      `,
      payload
    ),
  ]);

  return rows.map((row) => row.line_item_id);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const cookieStore = await cookies();

    const bodyToken = String(body.accessToken || "").trim();
    const cookieToken = String(cookieStore.get("procore_access_token")?.value || "").trim();
    let accessToken = cookieToken || bodyToken;
    if (!accessToken) {
      try {
        accessToken = await getClientCredentialsToken();
      } catch {
        return NextResponse.json(
          { error: "Missing access token. Authenticate with Procore or configure client credentials." },
          { status: 401 }
        );
      }
    }

    const companyId = String(
      body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId || ""
    ).trim();

    if (!companyId) {
      return NextResponse.json({ error: "Missing required field: companyId" }, { status: 400 });
    }

    const requestedBaseUrl = String(
      body.baseUrl || process.env.PROCORE_ESTIMATING_API_URL || DEFAULT_ESTIMATING_BASE_URL
    ).trim();

    const fetchAll = body.fetchAll === true;
    const persist = body.persist === true;
    const includeProjectSummaries = body.includeProjectSummaries !== false;
    const includeLineItems = body.includeLineItems !== false;
    const perPage = Math.min(200, Math.max(1, Number.parseInt(String(body.perPage || "100"), 10) || 100));
    const bidBoardStatusFilter = String(body["filters[by_status]"] || body.bidBoardStatusFilter || "All").trim() || "All";

    const maxBidBoardProjects = Math.min(5000, Math.max(1, Number.parseInt(String(body.maxBidBoardProjects || "100"), 10) || 100));
    const bidBoardProjectOffset = Math.max(
      0,
      Number.parseInt(String(body.bidBoardProjectOffset || "0"), 10) || 0
    );
    const explicitBidBoardProjectIds = new Set(
      (Array.isArray(body.bidBoardProjectIds)
        ? body.bidBoardProjectIds
        : String(body.bidBoardProjectIds || "").split(","))
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    );
    const maxProposalsPerProject = Math.min(500, Math.max(1, Number.parseInt(String(body.maxProposalsPerProject || "50"), 10) || 50));
    const maxLineItemsPages = Math.min(100, Math.max(1, Number.parseInt(String(body.maxLineItemsPages || "10"), 10) || 10));

    const hostCandidates = buildAllowedProcoreHostCandidates({
      requestedOrigin: requestedBaseUrl,
      extraOrigins: [process.env.PROCORE_ESTIMATING_API_URL, DEFAULT_ESTIMATING_BASE_URL, "https://api.procore.com"],
    });

    if (hostCandidates.error) {
      return NextResponse.json({ error: hostCandidates.error }, { status: 400 });
    }

    const attempts: Array<{ host: string; status: number; message: string }> = [];

    for (const host of hostCandidates.candidates) {
      const baseHost = host.replace(/\/$/, "");

      if (persist) {
        try {
          await assertProposalLineItemsLiveTableExists();
        } catch (tableError) {
          if (isMissingTableError(tableError)) {
            return NextResponse.json(
              {
                error: "Persisted proposal line items table is unavailable",
                details:
                  "Apply the Prisma migration for procore_proposal_line_items_live before using persist=true.",
                host,
              },
              { status: 503 }
            );
          }

          throw tableError;
        }
      }

      const persistence = {
        enabled: persist,
        attempted: 0,
        persisted: 0,
        failed: 0,
        staleProposalsRemoved: 0,
        errors: [] as string[],
      };

      async function getJson(path: string): Promise<unknown> {
        const response = await fetch(`${baseHost}${path}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
            "Procore-Company-Id": companyId,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          const err = new Error(`HTTP ${response.status}: ${errorText || "No response body"}`) as Error & {
            status?: number;
            details?: string;
          };
          err.status = response.status;
          err.details = errorText;
          throw err;
        }

        return response.json();
      }

      try {
        const bidBoardProjects: unknown[] = [];
        let page = 1;

        while (true) {
          const params = new URLSearchParams({
            page: String(page),
            per_page: String(perPage),
          });
          if (bidBoardStatusFilter) {
            params.set("filters[by_status]", bidBoardStatusFilter);
          }

          const payload = await getJson(
            `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects?${params.toString()}`
          );
          const pageItems = asArray(payload, ["data", "projects", "bid_board_projects"]);
          if (pageItems.length === 0) break;

          bidBoardProjects.push(...pageItems);
          const fetchTarget = explicitBidBoardProjectIds.size > 0
            ? Number.POSITIVE_INFINITY
            : bidBoardProjectOffset + maxBidBoardProjects;
          if (!fetchAll || pageItems.length < perPage || bidBoardProjects.length >= fetchTarget) break;
          page += 1;
        }

        if (explicitBidBoardProjectIds.size > 0) {
          const fetchedIds = new Set(bidBoardProjects.map((project) => {
            const record = isRecord(project) ? project : {};
            return String(record.id || record.bid_board_project_id || "").trim();
          }).filter(Boolean));
          for (const bidBoardProjectId of explicitBidBoardProjectIds) {
            if (fetchedIds.has(bidBoardProjectId)) continue;
            bidBoardProjects.push({ id: bidBoardProjectId });
          }
        }

        const selectedBidBoardProjects = explicitBidBoardProjectIds.size > 0
          ? bidBoardProjects.filter((project) => {
              const record = isRecord(project) ? project : {};
              const id = String(record.id || record.bid_board_project_id || "").trim();
              return explicitBidBoardProjectIds.has(id);
            })
          : bidBoardProjects;
        const limitedBidBoardProjects = selectedBidBoardProjects.slice(
          bidBoardProjectOffset,
          bidBoardProjectOffset + maxBidBoardProjects
        );
        const lineItems: unknown[] = [];
        const projectSummaries: Array<{
          bidBoardProjectId: string;
          proposalCount: number;
          lineItemCount: number;
          staleProposalCount: number;
        }> = [];

        for (const project of limitedBidBoardProjects) {
          const projectRecord = isRecord(project) ? project : {};
          const bidBoardProjectId = String(projectRecord.id || projectRecord.bid_board_project_id || "").trim();
          if (!bidBoardProjectId) continue;
          const projectName = String(projectRecord.name || projectRecord.title || "").trim() || null;
          const customerName = (
            String(projectRecord.customer_name || "").trim() ||
            (isRecord(projectRecord.customer_company)
              ? String(projectRecord.customer_company.name || "").trim()
              : "") ||
            null
          );
          const procoreProjectId = await resolveProcoreProjectId(
            companyId,
            bidBoardProjectId,
            projectRecord
          );

          const proposals: unknown[] = [];
          let proposalPage = 1;
          let proposalsAuthoritative = fetchAll;

          while (true) {
            try {
              const proposalPayload = await getJson(
                `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
                  bidBoardProjectId
                )}/proposals?page=${proposalPage}&per_page=${perPage}`
              );
              const proposalItems = asArray(proposalPayload, ["data", "proposals"]);
              if (proposalItems.length === 0) break;
              proposals.push(...proposalItems);
              if (!fetchAll) {
                proposalsAuthoritative = proposalItems.length < perPage;
                break;
              }
              if (proposals.length > maxProposalsPerProject) {
                proposalsAuthoritative = false;
                break;
              }
              if (proposalItems.length < perPage) break;
              if (proposals.length >= maxProposalsPerProject) {
                proposalsAuthoritative = false;
                break;
              }
              proposalPage += 1;
            } catch (error) {
              const status = Number((error as { status?: number })?.status || 0);
              if (status === 404) {
                proposalsAuthoritative = false;
                break;
              }
              throw error;
            }
          }

          const limitedProposals = proposals.slice(0, maxProposalsPerProject);
          let projectLineItemCount = 0;

          for (const proposal of limitedProposals) {
            const proposalRecord = isRecord(proposal) ? proposal : {};
            const proposalId = String(proposalRecord.id || proposalRecord.proposal_id || "").trim();
            if (!proposalId) continue;
            const proposalName =
              String(proposalRecord.name || proposalRecord.title || proposalRecord.proposal_number || "").trim() || null;

            if (persist) {
              await upsertEstimateProposal({
                companyId,
                bidBoardProjectId,
                procoreProjectId,
                projectName,
                customerName,
                proposalId,
                proposalName,
                proposal: proposalRecord,
              });
            }

            let lineItemPage = 1;
            const failedBeforeProposal = persistence.failed;
            const persistedLineItemIds: string[] = [];
            let lineItemsAuthoritative = true;
            while (true) {
              try {
                const lineItemsPayload = await getJson(
                  `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
                    bidBoardProjectId
                  )}/proposals/${encodeURIComponent(proposalId)}/line_items?page=${lineItemPage}&per_page=${perPage}`
                );

                const proposalLineItems = asArray(lineItemsPayload, ["data", "line_items", "items"]);
                if (proposalLineItems.length === 0) break;

                for (const item of proposalLineItems) {
                  lineItems.push({
                    bidBoardProjectId,
                    projectName,
                    customerName,
                    proposalId,
                    proposalName,
                    lineItem: item,
                  });

                }

                if (persist) {
                  persistence.attempted += proposalLineItems.length;
                  try {
                    const persistedIds = await upsertProposalLineItemsBatch({
                      companyId,
                      bidBoardProjectId,
                      proposalId,
                      procoreProjectId,
                      projectName,
                      customerName,
                      proposalName,
                      lineItems: proposalLineItems,
                    });
                    persistedLineItemIds.push(...persistedIds);
                    persistence.persisted += persistedIds.length;
                  } catch (persistError) {
                    if (isMissingTableError(persistError)) {
                      throw persistError;
                    }

                    persistence.failed += proposalLineItems.length;
                    if (persistence.errors.length < 25) {
                      const msg = persistError instanceof Error ? persistError.message : String(persistError);
                      persistence.errors.push(`${bidBoardProjectId}/${proposalId}: ${msg}`);
                    }
                  }
                }

                projectLineItemCount += proposalLineItems.length;

                if (!fetchAll || proposalLineItems.length < perPage || lineItemPage >= maxLineItemsPages) break;
                lineItemPage += 1;
              } catch (error) {
                const status = Number((error as { status?: number })?.status || 0);
                if (status === 404) {
                  lineItemsAuthoritative = false;
                  break;
                }
                throw error;
              }
            }

            if (persist && lineItemsAuthoritative && persistence.failed === failedBeforeProposal) {
              await reconcileNormalizedEstimateLines({
                companyId,
                bidBoardProjectId,
                proposalId,
                lineItemIds: persistedLineItemIds,
              });
            }
          }

          const currentProposalIds = limitedProposals
            .map((proposal) => {
              const record = isRecord(proposal) ? proposal : {};
              return String(record.id || record.proposal_id || "").trim();
            })
            .filter(Boolean);
          const staleProposalCount = persist && proposalsAuthoritative
            ? await reconcileEstimateProposals({
                companyId,
                bidBoardProjectId,
                proposalIds: currentProposalIds,
              })
            : 0;
          persistence.staleProposalsRemoved += staleProposalCount;

          projectSummaries.push({
            bidBoardProjectId,
            proposalCount: limitedProposals.length,
            lineItemCount: projectLineItemCount,
            staleProposalCount,
          });
        }

        return NextResponse.json({
          success: true,
          source: "estimating.proposal_line_items_bulk",
          companyId,
          baseUrl: baseHost,
          filters: {
            byStatus: bidBoardStatusFilter || null,
          },
          limits: {
            fetchAll,
            perPage,
            maxBidBoardProjects,
            bidBoardProjectOffset,
            explicitBidBoardProjectIds: explicitBidBoardProjectIds.size,
            maxProposalsPerProject,
            maxLineItemsPages,
          },
          counts: {
            bidBoardProjectsFetched: bidBoardProjects.length,
            bidBoardProjectsProcessed: limitedBidBoardProjects.length,
            projectSummaries: projectSummaries.length,
            lineItems: lineItems.length,
          },
          persistence,
          projectSummaries: includeProjectSummaries ? projectSummaries : [],
          lineItems: includeLineItems ? lineItems : [],
        });
      } catch (error) {
        if (persist && isMissingTableError(error)) {
          return NextResponse.json(
            {
              error: "Persisted proposal line items table is unavailable",
              details:
                "Apply the Prisma migration for procore_proposal_line_items_live before using persist=true.",
              host,
            },
            { status: 503 }
          );
        }

        const status = Number((error as { status?: number })?.status || 500);
        const details = (error as { details?: string })?.details || (error instanceof Error ? error.message : String(error));

        attempts.push({
          host,
          status,
          message: details,
        });

        if (status !== 404) {
          return NextResponse.json(
            {
              error: `Bulk proposal line items API error ${status}`,
              details,
              host,
              attempts,
            },
            { status }
          );
        }
      }
    }

    return NextResponse.json(
      {
        error: "Failed to fetch bulk proposal line items",
        details: "All configured hosts failed",
        attempts,
      },
      { status: 404 }
    );
  } catch (error) {
    if (isMissingTableError(error)) {
      return NextResponse.json(
        {
          error: "Persisted proposal line items table is unavailable",
          details:
            "Apply the Prisma migration for procore_proposal_line_items_live before using persist=true.",
        },
        { status: 503 }
      );
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to fetch bulk proposal line items",
        details: message,
      },
      { status: 500 }
    );
  }
}

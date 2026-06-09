import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";
import { getClientCredentialsToken, refreshAccessToken } from "@/lib/procore";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";
import { prisma } from "@/lib/prisma";

const DEFAULT_ESTIMATING_BASE_URL = "https://api.procore.com";

type UnknownRecord = Record<string, unknown>;
type WorkbookRow = Record<string, unknown>;
type ProcoreRequestTrace = {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  payload: unknown;
  status: number;
  tokenSource: string;
};

type NormalizedGroup = {
  key: string;
  name: string;
  payload?: UnknownRecord;
};

type NormalizedLineItem = {
  groupKey: string;
  payload: UnknownRecord;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function cloneForTrace<T>(value: T): T {
  if (value === null || value === undefined) return value;
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function collectMatchedKeys(
  value: unknown,
  matcher: (key: string) => boolean,
  parentPath = ""
): string[] {
  if (!isRecord(value) && !Array.isArray(value)) return [];

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectMatchedKeys(entry, matcher, `${parentPath}[${index}]`));
  }

  const matches: string[] = [];
  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPath = parentPath ? `${parentPath}.${key}` : key;
    if (matcher(key)) {
      matches.push(nextPath);
    }
    matches.push(...collectMatchedKeys(nestedValue, matcher, nextPath));
  }
  return matches;
}

function extractRequestIdFromErrorText(errorText: string | undefined): string | null {
  if (!errorText) return null;

  try {
    const parsed = JSON.parse(errorText);
    if (isRecord(parsed)) {
      const value = toStringValue(parsed.requestId);
      return value || null;
    }
  } catch {
    // Fall through to regex extraction.
  }

  const regexMatch = errorText.match(/"requestId"\s*:\s*"([^"]+)"/i);
  return regexMatch?.[1] || null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9.-]/g, "").trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function toStringValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "bigint") return value.toString();
  return "";
}

function normalizeKey(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeRow(row: WorkbookRow): UnknownRecord {
  const normalized: UnknownRecord = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeKey(key)] = value;
  }
  return normalized;
}

function pickString(row: UnknownRecord, keys: string[]): string {
  for (const key of keys) {
    const value = toStringValue(row[key]);
    if (value) return value;
  }
  return "";
}

function pickNumber(row: UnknownRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = toFiniteNumber(row[key]);
    if (value !== null) return value;
  }
  return null;
}

function parseWorkbookRows(rows: WorkbookRow[]): {
  groups: NormalizedGroup[];
  lineItems: NormalizedLineItem[];
} {
  const groupsByKey = new Map<string, NormalizedGroup>();
  const lineItems: NormalizedLineItem[] = [];
  let sectionCounter = 1;
  let fallbackCounter = 1;
  let currentSectionKey: string | null = null;

  const ensureSection = (nameHint?: string): string => {
    const sectionName = nameHint && nameHint.trim() ? nameHint.trim() : `Imported Group ${fallbackCounter}`;
    const key = `section-${sectionCounter}`;
    sectionCounter += 1;
    fallbackCounter += 1;
    groupsByKey.set(key, {
      key,
      name: sectionName,
    });
    return key;
  };

  for (const row of rows) {
    if (!isRecord(row)) continue;

    const normalized = normalizeRow(row);

    const groupName =
      pickString(normalized, [
        "groupname",
        "section",
        "category",
        "division",
        "header",
        "costitem",
      ]) ||
      "";

    const costCode = pickString(normalized, ["costcode", "code", "wbs", "wbscode"]);
    const itemName = pickString(normalized, ["name", "lineitem", "description", "costitemname", "itemname"]);
    const quantity = pickNumber(normalized, ["quantity", "qty", "takeoffqty"]);
    const uom = pickString(normalized, ["uom", "unit", "unitofmeasure", "type"]);
    const itemCost = pickNumber(normalized, ["itemcost", "materialcost", "cost"]);
    const itemSales = pickNumber(normalized, ["itemsales", "sales"]);
    const laborCost = pickNumber(normalized, ["laborcost", "labourcost"]);
    const laborSales = pickNumber(normalized, ["laborsales", "laboursales"]);

    const hasCostValues = itemCost !== null || itemSales !== null || laborCost !== null || laborSales !== null;
    const hasLineIdentity = Boolean(costCode || itemName || quantity !== null || uom);
    const isSectionHeader = Boolean(groupName) && !hasLineIdentity;

    if (isSectionHeader) {
      currentSectionKey = ensureSection(groupName);

      // Keep section totals as a synthetic line item when present.
      if (hasCostValues) {
        lineItems.push({
          groupKey: currentSectionKey,
          payload: {
            name: `${groupName} Summary`,
            ...(itemCost !== null ? { item_cost: itemCost } : {}),
            ...(itemSales !== null ? { item_sales: itemSales } : {}),
            ...(laborCost !== null ? { labor_cost: laborCost } : {}),
            ...(laborSales !== null ? { labor_sales: laborSales } : {}),
          },
        });
      }

      continue;
    }

    const hasLineItemSignals = Boolean(
      costCode ||
        itemName ||
        quantity !== null ||
        uom ||
        itemCost !== null ||
        itemSales !== null ||
        laborCost !== null ||
        laborSales !== null
    );

    if (!hasLineItemSignals) {
      continue;
    }

    if (!currentSectionKey) {
      currentSectionKey = ensureSection(groupName || `Imported Group ${fallbackCounter}`);
    }

    const linePayload: UnknownRecord = {
      ...(itemName ? { name: itemName } : groupName ? { name: groupName } : {}),
      ...(quantity !== null ? { quantity } : {}),
      ...(uom ? { type: uom } : {}),
      ...(itemCost !== null ? { item_cost: itemCost } : {}),
      ...(itemSales !== null ? { item_sales: itemSales } : {}),
      ...(laborCost !== null ? { labor_cost: laborCost } : {}),
      ...(laborSales !== null ? { labor_sales: laborSales } : {}),
      ...(costCode ? { cost_code: { code: costCode } } : {}),
    };

    if (Object.keys(linePayload).length > 0) {
      lineItems.push({
        groupKey: currentSectionKey,
        payload: linePayload,
      });
    }
  }

  return {
    groups: Array.from(groupsByKey.values()),
    lineItems,
  };
}

function extractId(payload: unknown, keys: string[]): string | null {
  const container = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
  if (!isRecord(container)) return null;
  for (const key of keys) {
    const value = toStringValue(container[key]);
    if (value) return value;
  }
  return null;
}

function extractRecord(payload: unknown): UnknownRecord | null {
  if (isRecord(payload) && isRecord(payload.data)) return payload.data;
  if (isRecord(payload)) return payload;
  return null;
}

async function getLocalBidBoardSnapshot(params: {
  companyId: string;
  bidBoardProjectId: string;
}): Promise<{ projectId: string | null; projectName: string; customer: string } | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{
      procore_project_id: string | null;
      name: string | null;
      customer: string | null;
    }>>(
      `
        SELECT procore_project_id, name, customer
        FROM procore_bid_board_live
        WHERE bid_board_id = $1
          AND (
            company_id = $2
            OR company_id IS NULL
            OR company_id = ''
          )
        ORDER BY
          CASE WHEN company_id = $2 THEN 0 ELSE 1 END,
          synced_at DESC
        LIMIT 1
      `,
      params.bidBoardProjectId,
      params.companyId
    );

    if (rows.length === 0) return null;

    return {
      projectId: toStringValue(rows[0]?.procore_project_id) || null,
      projectName: toStringValue(rows[0]?.name),
      customer: toStringValue(rows[0]?.customer),
    };
  } catch {
    return null;
  }
}

async function resolveProjectIdFromLocalBidBoard(params: {
  companyId: string;
  bidBoardProjectId: string;
}): Promise<string | null> {
  try {
    const snapshot = await getLocalBidBoardSnapshot(params);
    const projectId = snapshot?.projectId || null;
    if (projectId) {
      return projectId;
    }

    const projectName = snapshot?.projectName || "";
    const customer = snapshot?.customer || "";

    if (projectName && customer) {
      const siblingRows = await prisma.$queryRawUnsafe<Array<{ procore_project_id: string | null }>>(
        `
          SELECT DISTINCT procore_project_id
          FROM procore_bid_board_live
          WHERE name = $1
            AND customer = $2
            AND COALESCE(NULLIF(procore_project_id, ''), '') <> ''
            AND (
              company_id = $3
              OR company_id IS NULL
              OR company_id = ''
            )
          LIMIT 5
        `,
        projectName,
        customer,
        params.companyId
      );

      const siblingProjectIds = Array.from(
        new Set(siblingRows.map((row) => toStringValue(row.procore_project_id)).filter(Boolean))
      );

      if (siblingProjectIds.length === 1) {
        return siblingProjectIds[0];
      }

      const canonicalProjects = await prisma.project.findMany({
        where: {
          projectName,
          customer,
          procoreId: {
            not: null,
          },
        },
        select: {
          procoreId: true,
        },
        take: 5,
      });

      const canonicalProjectIds = Array.from(
        new Set(canonicalProjects.map((project) => toStringValue(project.procoreId)).filter(Boolean))
      );

      if (canonicalProjectIds.length === 1) {
        return canonicalProjectIds[0];
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function resolveProjectIdFromBidBoard(params: {
  host: string;
  companyId: string;
  accessToken: string;
  bidBoardProjectId: string;
}): Promise<string | null> {
  const localProjectId = await resolveProjectIdFromLocalBidBoard({
    companyId: params.companyId,
    bidBoardProjectId: params.bidBoardProjectId,
  });

  if (localProjectId) {
    return localProjectId;
  }

  const directLookup = await procoreRequest({
    host: params.host,
    companyId: params.companyId,
    accessToken: params.accessToken,
    method: "GET",
    path: `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/estimating/bid_board_projects/${encodeURIComponent(
      params.bidBoardProjectId
    )}`,
  });

  if (directLookup.ok) {
    const record = extractRecord(directLookup.body);
    const directProjectId = toStringValue(record?.project_id || record?.procore_project_id || record?.projectId);
    if (directProjectId) return directProjectId;
  }

  for (let page = 1; page <= 20; page += 1) {
    const listResponse = await procoreRequest({
      host: params.host,
      companyId: params.companyId,
      accessToken: params.accessToken,
      method: "GET",
      path: `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/estimating/bid_board_projects?page=${page}&per_page=100`,
    });

    if (!listResponse.ok) break;

    const body = listResponse.body;
    const list = Array.isArray(body)
      ? body
      : isRecord(body) && Array.isArray(body.data)
        ? body.data
        : isRecord(body) && Array.isArray(body.bid_board_projects)
          ? body.bid_board_projects
          : [];

    if (list.length === 0) break;

    const match = list.find((entry) => {
      if (!isRecord(entry)) return false;
      return toStringValue(entry.id || entry.bid_board_project_id) === params.bidBoardProjectId;
    });

    if (isRecord(match)) {
      const projectId = toStringValue(match.project_id || match.procore_project_id || match.projectId);
      if (projectId) return projectId;
    }
  }

  return null;
}

async function procoreRequest(params: {
  host: string;
  companyId: string;
  accessToken: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  payload?: UnknownRecord;
}): Promise<{ ok: boolean; status: number; body: unknown; text: string }> {
  const response = await fetch(`${params.host.replace(/\/$/, "")}${params.path}`, {
    method: params.method,
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Procore-Company-Id": params.companyId,
    },
    body: params.payload ? JSON.stringify(params.payload) : undefined,
  });

  const text = await response.text();
  let body: unknown = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = text;
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
    text,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const cookieStore = await cookies();

    const bodyToken = String(body.accessToken || "").trim();
    const cookieToken = String(cookieStore.get("procore_access_token")?.value || "").trim();
    let accessToken = cookieToken || bodyToken;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token. Authenticate with Procore first or provide accessToken." },
        { status: 401 }
      );
    }

    const companyId = String(
      body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId || ""
    ).trim();
    const bidBoardProjectId = String(body.bidBoardProjectId || body.bid_board_project_id || "").trim();

    if (!companyId || !bidBoardProjectId) {
      return NextResponse.json(
        { error: "Missing required fields: companyId, bidBoardProjectId" },
        { status: 400 }
      );
    }

    const requestedBaseUrl = String(
      body.baseUrl || process.env.PROCORE_ESTIMATING_API_URL || DEFAULT_ESTIMATING_BASE_URL
    ).trim();
    const dryRun = body.dryRun !== false;
    const createProposal = body.createProposal !== false;

    const hostCandidates = buildAllowedProcoreHostCandidates({
      requestedOrigin: requestedBaseUrl,
      extraOrigins: [process.env.PROCORE_ESTIMATING_API_URL, DEFAULT_ESTIMATING_BASE_URL, "https://api.procore.com"],
    });

    if (hostCandidates.error) {
      return NextResponse.json({ error: hostCandidates.error }, { status: 400 });
    }

    const workingHost = hostCandidates.candidates[0];
    if (!workingHost) {
      return NextResponse.json({ error: "No allowed Procore host candidates found." }, { status: 400 });
    }

    const explicitGroups = Array.isArray(body.groups)
      ? body.groups.filter(isRecord).map((group) => ({
          key: toStringValue(group.key) || toStringValue(group.groupKey) || `group-${Math.random().toString(36).slice(2, 8)}`,
          name: toStringValue(group.name) || "Imported Group",
          payload: isRecord(group.payload) ? group.payload : undefined,
        }))
      : [];

    const explicitLineItems = Array.isArray(body.lineItems)
      ? body.lineItems
          .filter(isRecord)
          .map((item) => {
            const payload = isRecord(item.payload) ? item.payload : undefined;
            if (!payload) return null;
            return {
              groupKey: toStringValue(item.groupKey) || "group-1",
              payload,
            } as NormalizedLineItem;
          })
          .filter((item): item is NormalizedLineItem => Boolean(item))
      : [];

    const workbookRows = Array.isArray(body.rows)
      ? body.rows.filter(isRecord).map((row) => row as WorkbookRow)
      : [];

    const parsedWorkbook = parseWorkbookRows(workbookRows);

    const groups = explicitGroups.length > 0 ? explicitGroups : parsedWorkbook.groups;
    const lineItems = explicitLineItems.length > 0 ? explicitLineItems : parsedWorkbook.lineItems;

    const proposalPayload = isRecord(body.proposal)
      ? body.proposal
      : {
          name: toStringValue(body.proposalName) || `Imported Estimate ${new Date().toISOString().slice(0, 10)}`,
        };

    const existingProposalId = toStringValue(body.proposalId || body.proposal_id);
    const explicitProjectId = toStringValue(body.projectId || body.project_id || body.procoreProjectId || body.procore_project_id);

    if (!existingProposalId && !createProposal) {
      return NextResponse.json(
        { error: "proposalId is required when createProposal=false." },
        { status: 400 }
      );
    }

    if (groups.length === 0 && lineItems.length === 0) {
      return NextResponse.json(
        { error: "No groups or line items were provided or parsed from rows." },
        { status: 400 }
      );
    }

    if (dryRun) {
      return NextResponse.json({
        success: true,
        source: "estimating.import_estimate_workbook",
        mode: "dry-run",
        companyId,
        bidBoardProjectId,
        baseUrl: workingHost,
        plan: {
          targetScope: explicitProjectId ? "project" : "auto",
          createProposal: !existingProposalId && createProposal,
          proposalPayload,
          groupCount: groups.length,
          lineItemCount: lineItems.length,
          sampleGroups: groups.slice(0, 10),
          sampleLineItems: lineItems.slice(0, 15),
        },
      });
    }

    const userAccessToken = accessToken;
    let tokenSource: "client_credentials" | "user_oauth" | "user_oauth_fallback" = "user_oauth";
    try {
      accessToken = await getClientCredentialsToken();
      tokenSource = "client_credentials";
    } catch {
      if (!userAccessToken) {
        return NextResponse.json(
          { error: "Missing access token. Authenticate with Procore first or configure client credentials." },
          { status: 401 }
        );
      }
      accessToken = userAccessToken;
      tokenSource = "user_oauth";
    }

    const resolvedProjectId =
      explicitProjectId ||
      (await resolveProjectIdFromBidBoard({
        host: workingHost,
        companyId,
        accessToken,
        bidBoardProjectId,
      }));
    let endpointScope: "project" | "bid_board" = resolvedProjectId ? "project" : "bid_board";

    // If caller supplied an existing proposal id, auto-detect which scope actually owns it.
    if (existingProposalId && !explicitProjectId && resolvedProjectId) {
      const projectProposalProbe = await procoreRequest({
        host: workingHost,
        companyId,
        accessToken,
        method: "GET",
        path: `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(
          resolvedProjectId
        )}/estimating/proposals/${encodeURIComponent(existingProposalId)}`,
      });

      if (!projectProposalProbe.ok) {
        const bidBoardProposalProbe = await procoreRequest({
          host: workingHost,
          companyId,
          accessToken,
          method: "GET",
          path: `/rest/v2.0/companies/${encodeURIComponent(
            companyId
          )}/estimating/bid_board_projects/${encodeURIComponent(bidBoardProjectId)}/proposals/${encodeURIComponent(
            existingProposalId
          )}`,
        });

        if (bidBoardProposalProbe.ok) {
          endpointScope = "bid_board";
        }
      }
    }

    let proposalId = existingProposalId || "";
    let proposalCreatedByImport = false;
    const createdGroups: Array<{ key: string; id: string; name: string }> = [];
    const lineItemResults: Array<{
      index: number;
      lineItemId: string | null;
      groupKey: string;
      payloadVariantsTried: number;
      error?: string;
    }> = [];
    const requestTrace: ProcoreRequestTrace[] = [];

    let attemptedTokenRefresh = false;
    function isAppOwnerForbidden(response: { status: number; text: string }): boolean {
      return response.status === 403 && /Unpermitted access for the app owner/i.test(response.text || "");
    }
    function isAuthForbidden(response: { status: number; text: string }): boolean {
      return response.status === 403 && /Unauthorized|Forbidden/i.test(response.text || "");
    }
    function isUnsupportedLayerType(response: { status: number; text: string }): boolean {
      return response.status === 500 && /Unsupported LayerType/i.test(response.text || "");
    }

    const sendProcoreRequest = async (params: {
      method: "GET" | "POST" | "DELETE";
      path: string;
      payload?: UnknownRecord;
    }) => {
      let response = await procoreRequest({
        host: workingHost,
        companyId,
        accessToken,
        method: params.method,
        path: params.path,
        payload: params.payload,
      });
      requestTrace.push({
        method: params.method,
        path: params.path,
        payload: cloneForTrace(params.payload ?? null),
        status: response.status,
        tokenSource,
      });

      if (
        tokenSource === "client_credentials" &&
        userAccessToken &&
        (isAppOwnerForbidden(response) || isAuthForbidden(response) || isUnsupportedLayerType(response))
      ) {
        accessToken = userAccessToken;
        tokenSource = "user_oauth_fallback";
        response = await procoreRequest({
          host: workingHost,
          companyId,
          accessToken,
          method: params.method,
          path: params.path,
          payload: params.payload,
        });
        requestTrace.push({
          method: params.method,
          path: params.path,
          payload: cloneForTrace(params.payload ?? null),
          status: response.status,
          tokenSource,
        });
      }

      if (response.status === 401 && tokenSource !== "client_credentials" && !attemptedTokenRefresh) {
        attemptedTokenRefresh = true;
        const refreshToken = String(cookieStore.get("procore_refresh_token")?.value || "").trim();

        if (refreshToken) {
          try {
            const refreshed = await refreshAccessToken(refreshToken);
            if (refreshed.access_token) {
              accessToken = String(refreshed.access_token).trim();
              cookieStore.set("procore_access_token", accessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
                path: "/",
                maxAge: refreshed.expires_in || 7200,
              });

              if (refreshed.refresh_token) {
                cookieStore.set("procore_refresh_token", String(refreshed.refresh_token), {
                  httpOnly: true,
                  secure: process.env.NODE_ENV === "production",
                  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
                  path: "/",
                  maxAge: 30 * 24 * 60 * 60,
                });
              }

              const refreshedScope = String(refreshed.scope || "").trim();
              if (refreshedScope) {
                cookieStore.set("procore_scope", refreshedScope, {
                  httpOnly: true,
                  secure: process.env.NODE_ENV === "production",
                  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
                  path: "/",
                  maxAge: refreshed.expires_in || 7200,
                });
              }

              response = await procoreRequest({
                host: workingHost,
                companyId,
                accessToken,
                method: params.method,
                path: params.path,
                payload: params.payload,
              });
              requestTrace.push({
                method: params.method,
                path: params.path,
                payload: cloneForTrace(params.payload ?? null),
                status: response.status,
                tokenSource,
              });
            }
          } catch {
            // If refresh fails, fall through and return the original unauthorized response.
          }
        }
      }

      return response;
    };

    const buildProposalPath = () =>
      endpointScope === "project"
        ? `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(
            resolvedProjectId || ""
          )}/estimating/proposals`
        : `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
            bidBoardProjectId
          )}/proposals`;

    const buildGroupPath = () =>
      endpointScope === "project"
        ? `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(
            resolvedProjectId || ""
          )}/estimating/proposals/${encodeURIComponent(proposalId)}/line_item_groups`
        : `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
            bidBoardProjectId
          )}/proposals/${encodeURIComponent(proposalId)}/line_item_groups`;

    const buildLineItemPath = () =>
      endpointScope === "project"
        ? `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(
            resolvedProjectId || ""
          )}/estimating/proposals/${encodeURIComponent(proposalId)}/line_items`
        : `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
            bidBoardProjectId
          )}/proposals/${encodeURIComponent(proposalId)}/line_items`;

    const buildGroupDeletePath = (groupId: string) =>
      endpointScope === "project"
        ? `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(
            resolvedProjectId || ""
          )}/estimating/proposals/${encodeURIComponent(proposalId)}/line_item_groups/${encodeURIComponent(groupId)}`
        : `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
            bidBoardProjectId
          )}/proposals/${encodeURIComponent(proposalId)}/line_item_groups/${encodeURIComponent(groupId)}`;

    const buildProposalDeletePath = () =>
      endpointScope === "project"
        ? `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(
            resolvedProjectId || ""
          )}/estimating/proposals/${encodeURIComponent(proposalId)}`
        : `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
            bidBoardProjectId
          )}/proposals/${encodeURIComponent(proposalId)}`;

    if (!proposalId && createProposal) {
      const createProposalResponse = await sendProcoreRequest({
        method: "POST",
        path: buildProposalPath(),
        payload: {
          type: "ESTIMATE",
          ...proposalPayload,
        },
      });

      if (!createProposalResponse.ok) {
        const authHint =
          createProposalResponse.status === 401
            ? " Procore denied this write request. Re-authenticate via /api/auth/procore/login and confirm your Procore user has estimating write access to this project."
            : "";
        return NextResponse.json(
          {
            error: `Create proposal API error ${createProposalResponse.status}`,
            details: `${createProposalResponse.text}${authHint}`,
            payload: proposalPayload,
          },
          { status: createProposalResponse.status }
        );
      }

      proposalId = extractId(createProposalResponse.body, ["id", "proposal_id"]) || "";
      if (!proposalId) {
        return NextResponse.json(
          {
            error: "Proposal creation succeeded but proposal id was missing from response.",
            response: createProposalResponse.body,
          },
          { status: 502 }
        );
      }
      proposalCreatedByImport = true;
    }

    const groupIdByKey = new Map<string, string>();
    let blockedByUnsupportedLayerType = false;
    let lineItemsAttempted = 0;

    for (const group of groups) {
      const groupPayload = group.payload && Object.keys(group.payload).length > 0 ? group.payload : { name: group.name };
      const createGroupResponse = await sendProcoreRequest({
        method: "POST",
        path: buildGroupPath(),
        payload: {
          name: toStringValue(groupPayload.name) || group.name,
          ...(toStringValue(groupPayload.notes) ? { notes: toStringValue(groupPayload.notes) } : {}),
        },
      });

      if (!createGroupResponse.ok) {
        const authHint =
          createGroupResponse.status === 401
            ? " Procore denied this write request. Re-authenticate via /api/auth/procore/login and confirm estimating write access."
            : "";
        return NextResponse.json(
          {
            error: `Create line item group API error ${createGroupResponse.status}`,
            details: `${createGroupResponse.text}${authHint}`,
            group,
            payload: groupPayload,
          },
          { status: createGroupResponse.status }
        );
      }

      const createdGroupId = extractId(createGroupResponse.body, ["id", "line_item_group_id"]) || "";
      if (createdGroupId) {
        groupIdByKey.set(group.key, createdGroupId);
        createdGroups.push({ key: group.key, id: createdGroupId, name: group.name });
      }
    }

    for (let index = 0; index < lineItems.length; index += 1) {
      const lineItem = lineItems[index];
      lineItemsAttempted += 1;
      const lineItemGroupId = groupIdByKey.get(lineItem.groupKey);
      const currentPayload = lineItem.payload;
      const lineName = toStringValue(currentPayload.name) || `Imported line item ${index + 1}`;

      const parsedCount = Number(
        currentPayload.count ?? currentPayload.quantity ?? currentPayload.qty
      );
      const hasCount = Number.isFinite(parsedCount);

      const linePayloadBase: UnknownRecord = {
        name: lineName,
        ...(lineItemGroupId ? { group_id: lineItemGroupId } : {}),
        ...(hasCount ? { count: parsedCount } : {}),
      };
      const payloadVariants: UnknownRecord[] = [
        {
          ...linePayloadBase,
          cost_item: {
            name: lineName,
            type: "PART",
          },
        },
        {
          ...linePayloadBase,
          cost_item: {
            name: lineName,
          },
        },
        {
          ...linePayloadBase,
        },
      ];

      let createLineItemResponse: { ok: boolean; status: number; body: unknown; text: string } | null = null;
      let payloadVariantsTried = 0;

      for (const payload of payloadVariants) {
        payloadVariantsTried += 1;
        const response = await sendProcoreRequest({
          method: "POST",
          path: buildLineItemPath(),
          payload,
        });

        createLineItemResponse = response;

        if (response.ok) {
          break;
        }

        if (!isUnsupportedLayerType(response)) {
          break;
        }
      }

      if (!createLineItemResponse || !createLineItemResponse.ok) {
        const failedResponse = createLineItemResponse;
        const authHint =
          failedResponse?.status === 401
            ? " Procore denied write access. Re-authenticate and confirm estimating write permissions for this project."
            : "";
        if (failedResponse && isUnsupportedLayerType(failedResponse)) {
          blockedByUnsupportedLayerType = true;
        }
        lineItemResults.push({
          index,
          lineItemId: null,
          groupKey: lineItem.groupKey,
          payloadVariantsTried,
          error: `${failedResponse?.text || `HTTP ${failedResponse?.status || "UNKNOWN"}`}${authHint}`,
        });
        if (blockedByUnsupportedLayerType) {
          break;
        }
        continue;
      }

      lineItemResults.push({
        index,
        lineItemId: extractId(createLineItemResponse.body, ["id", "line_item_id"]),
        groupKey: lineItem.groupKey,
        payloadVariantsTried,
      });
    }

    const suspiciousKeyMatcher = (key: string) => {
      const normalized = key.toLowerCase();
      return (
        normalized === "layertype" ||
        normalized === "type" ||
        normalized === "view" ||
        normalized === "drawing" ||
        normalized === "document" ||
        normalized === "map" ||
        normalized === "attachment"
      );
    };

    const requestBodyKeyMatches = requestTrace
      .map((entry, traceIndex) => ({
        traceIndex,
        method: entry.method,
        path: entry.path,
        status: entry.status,
        tokenSource: entry.tokenSource,
        matchedKeys: collectMatchedKeys(entry.payload, suspiciousKeyMatcher),
      }))
      .filter((entry) => entry.matchedKeys.length > 0);

    let rollback: {
      attempted: boolean;
      reason: string | null;
      deletedGroups: string[];
      deletedProposal: boolean;
      errors: string[];
    } = {
      attempted: false,
      reason: null,
      deletedGroups: [],
      deletedProposal: false,
      errors: [],
    };

    const lineItemsCreatedCount = lineItemResults.filter((result) => !result.error).length;
    const lineItemsFailedCount = lineItemResults.filter((result) => Boolean(result.error)).length;
    const blockedRequestId = blockedByUnsupportedLayerType
      ? extractRequestIdFromErrorText(lineItemResults.find((result) => result.error)?.error)
      : null;

    if (lineItemsFailedCount > 0 && lineItemsCreatedCount === 0 && createdGroups.length > 0) {
      rollback.attempted = true;
      rollback.reason = blockedByUnsupportedLayerType
        ? "Unsupported LayerType"
        : "Line item creation failed before any line item could be created";

      for (const group of [...createdGroups].reverse()) {
        const deleteGroupResponse = await sendProcoreRequest({
          method: "DELETE",
          path: buildGroupDeletePath(group.id),
        });

        if (deleteGroupResponse.ok) {
          rollback.deletedGroups.push(group.id);
        } else {
          rollback.errors.push(
            `Failed to delete group ${group.id}: ${deleteGroupResponse.text || `HTTP ${deleteGroupResponse.status}`}`
          );
        }
      }

      if (proposalCreatedByImport) {
        const deleteProposalResponse = await sendProcoreRequest({
          method: "DELETE",
          path: buildProposalDeletePath(),
        });

        if (deleteProposalResponse.ok) {
          rollback.deletedProposal = true;
        } else {
          rollback.errors.push(
            `Failed to delete proposal ${proposalId}: ${deleteProposalResponse.text || `HTTP ${deleteProposalResponse.status}`}`
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      source: "estimating.import_estimate_workbook",
      mode: "live",
      endpointScope,
      companyId,
      bidBoardProjectId,
      projectId: resolvedProjectId || null,
      proposalId,
      baseUrl: workingHost,
      counts: {
        groupsRequested: groups.length,
        groupsCreated: createdGroups.length,
        lineItemsRequested: lineItems.length,
        lineItemsAttempted,
        lineItemsSkipped: Math.max(0, lineItems.length - lineItemsAttempted),
        lineItemsCreated: lineItemsCreatedCount,
        lineItemsFailed: lineItemsFailedCount,
      },
      blockedReason: blockedByUnsupportedLayerType ? "Unsupported LayerType" : null,
      blockedRequestId,
      requestTrace,
      requestBodyKeyMatches,
      rollback,
      createdGroups,
      lineItemResults,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to import estimate workbook",
        details: message,
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";

const DEFAULT_ESTIMATING_BASE_URL = "https://api.procore.com";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStr(value: unknown): string {
  return String(value || "").trim();
}

function extractEmbeddedArray(payload: unknown, keys: string[]): unknown[] {
  if (!isRecord(payload)) return [];
  for (const key of keys) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function extractBidBoardProjectId(payload: unknown, projectId: string): string | null {
  if (!isRecord(payload)) return null;

  const directProjectId = readStr(payload.project_id || payload.procore_project_id || payload.projectId);
  if (directProjectId && directProjectId === projectId) {
    return readStr(payload.id || payload.bid_board_project_id || payload.bidBoardProjectId) || null;
  }

  return null;
}

async function resolveBidBoardProjectId(options: {
  host: string;
  accessToken: string;
  companyId: string;
  projectId: string;
}): Promise<string | null> {
  const baseHost = options.host.replace(/\/$/, "");

  try {
    const directUrl = `${baseHost}/rest/v2.0/companies/${encodeURIComponent(
      options.companyId
    )}/estimating/bid_board_projects?page=1&per_page=100`;

    for (let page = 1; page <= 20; page += 1) {
      const url = page === 1 ? directUrl : `${baseHost}/rest/v2.0/companies/${encodeURIComponent(
        options.companyId
      )}/estimating/bid_board_projects?page=${page}&per_page=100`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          Accept: "application/json",
          "Procore-Company-Id": options.companyId,
        },
        cache: "no-store",
      });

      if (!response.ok) {
        if (response.status === 404) break;
        throw new Error(`Bid board project lookup failed ${response.status}`);
      }

      const payload = (await response.json().catch(() => ({}))) as unknown;
      const entries = extractEmbeddedArray(payload, ["data", "projects", "bid_board_projects"]);
      if (!entries.length) break;

      for (const entry of entries) {
        const match = extractBidBoardProjectId(entry, options.projectId);
        if (match) return match;
      }

      if (entries.length < 100) break;
    }
  } catch {
    return null;
  }

  return null;
}

async function fetchPagedCollection(options: {
  host: string;
  accessToken: string;
  companyId: string;
  urlPaths: Array<(page: number, perPage: number) => string>;
  arrayKeys: string[];
  perPage?: number;
}): Promise<{ items: unknown[]; attempts: Array<{ page: number; status: number; message: string }> }> {
  const items: unknown[] = [];
  const attempts: Array<{ page: number; status: number; message: string }> = [];
  const perPage = Math.min(100, Math.max(1, options.perPage || 100));

  for (const urlPath of options.urlPaths) {
    const candidateItems: unknown[] = [];
    let supported = false;

    for (let page = 1; page <= 100; page += 1) {
      const url = `${options.host.replace(/\/$/, "")}${urlPath(page, perPage)}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${options.accessToken}`,
          Accept: "application/json",
          "Procore-Company-Id": options.companyId,
        },
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        attempts.push({
          page,
          status: response.status,
          message: errorText || "No response body",
        });
        if (response.status === 404) {
          if (page === 1 && candidateItems.length === 0) {
            break;
          }
          supported = true;
          break;
        }
        throw new Error(`Collection API error ${response.status}: ${errorText || "No response body"}`);
      }

      supported = true;
      const payload = (await response.json().catch(() => ({}))) as unknown;
      const pageItems = extractEmbeddedArray(payload, options.arrayKeys);
      if (!pageItems.length) break;

      candidateItems.push(...pageItems);
      if (pageItems.length < perPage) break;
    }

    if (supported && candidateItems.length > 0) {
      items.push(...candidateItems);
      return { items, attempts };
    }
  }

  return { items, attempts };
}

function summarizeProposal(payload: unknown) {
  if (!isRecord(payload)) return null;

  const payloadData = isRecord(payload.data) ? payload.data : null;
  const embeddedLineItems = extractEmbeddedArray(payload, ["line_items", "items"]);
  const dataLineItems = payloadData && Array.isArray(payloadData.line_items) ? payloadData.line_items : [];

  return {
    id: readStr(payload.id || payload.proposal_id) || null,
    name: readStr(payload.name || payload.proposal_name || payload.title) || null,
    status: readStr(payload.status) || null,
    bidBoardProjectId: readStr(payload.bid_board_project_id || payload.bid_board_id) || null,
    projectId: readStr(payload.project_id || payload.procore_project_id) || null,
    lineItemCount: embeddedLineItems.length || dataLineItems.length || 0,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const cookieStore = await cookies();

    const bodyToken = readStr(body.accessToken);
    const cookieToken = readStr(cookieStore.get("procore_access_token")?.value);
    const accessToken = cookieToken || bodyToken;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Missing access token. Authenticate with Procore first or provide accessToken." },
        { status: 401 }
      );
    }

    const companyId = readStr(
      body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId || ""
    );
    const projectId = readStr(body.projectId || body.project_id || body.procoreProjectId || body.procore_project_id);
    const proposalId = readStr(body.proposalId || body.proposal_id);
    const bidBoardProjectId = readStr(
      body.bidBoardProjectId || body.bid_board_project_id || body.bidBoardId || body.bid_board_id
    );
    const requestedBaseUrl = readStr(
      body.baseUrl || process.env.PROCORE_ESTIMATING_API_URL || DEFAULT_ESTIMATING_BASE_URL
    );

    if (!companyId || !projectId || !proposalId) {
      return NextResponse.json(
        { error: "Missing required fields: companyId, projectId, proposalId" },
        { status: 400 }
      );
    }

    const hostCandidates = buildAllowedProcoreHostCandidates({
      requestedOrigin: requestedBaseUrl,
      extraOrigins: [process.env.PROCORE_ESTIMATING_API_URL, DEFAULT_ESTIMATING_BASE_URL, "https://api.procore.com"],
    });

    if (hostCandidates.error) {
      return NextResponse.json({ error: hostCandidates.error }, { status: 400 });
    }

    const attempts: Array<{ host: string; status: number; message: string }> = [];

    for (const host of hostCandidates.candidates) {
      const resolvedBidBoardProjectId = await resolveBidBoardProjectId({
        host,
        accessToken,
        companyId,
        projectId,
      });

      const url = `${host.replace(/\/$/, "")}/rest/v2.0/companies/${encodeURIComponent(
        companyId
      )}/projects/${encodeURIComponent(projectId)}/estimating/proposals/${encodeURIComponent(proposalId)}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Procore-Company-Id": companyId,
        },
        cache: "no-store",
      });

      if (!response.ok) {
        const errorText = await response.text();
        attempts.push({
          host,
          status: response.status,
          message: errorText || "No response body",
        });
        if (response.status === 404) continue;
        return NextResponse.json(
          {
            error: `Proposal show API error ${response.status}`,
            details: errorText,
            host,
            url,
          },
          { status: response.status }
        );
      }

      const payload = (await response.json().catch(() => ({}))) as unknown;
      const proposalRecord = isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
      const proposal = isRecord(proposalRecord) ? proposalRecord : {};

      const proposalLineItems = Array.isArray((proposal as UnknownRecord).line_items)
        ? ((proposal as UnknownRecord).line_items as unknown[])
        : [];
      const proposalLineItemGroups = Array.isArray((proposal as UnknownRecord).line_item_groups)
        ? ((proposal as UnknownRecord).line_item_groups as unknown[])
        : [];

      let lineItems = proposalLineItems;
      let lineItemGroups = proposalLineItemGroups;
      let lineItemAttempts: Array<{ page: number; status: number; message: string }> = [];
      let lineItemGroupAttempts: Array<{ page: number; status: number; message: string }> = [];

      try {
        const lineItemUrlPaths = [
          ...(resolvedBidBoardProjectId
            ? [
                (page: number, perPage: number) =>
                  `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
                    resolvedBidBoardProjectId
                  )}/proposals/${encodeURIComponent(proposalId)}/line_items?page=${page}&per_page=${perPage}`,
              ]
            : []),
          (page: number, perPage: number) =>
            `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(
              projectId
            )}/estimating/proposals/${encodeURIComponent(proposalId)}/line_items?page=${page}&per_page=${perPage}`,
        ];
        if (bidBoardProjectId) {
          lineItemUrlPaths.push(
            (page: number, perPage: number) =>
              `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
                bidBoardProjectId
              )}/proposals/${encodeURIComponent(proposalId)}/line_items?page=${page}&per_page=${perPage}`
          );
        }

        const lineItemResult = await fetchPagedCollection({
          host,
          accessToken,
          companyId,
          arrayKeys: ["data", "line_items", "items"],
          urlPaths: lineItemUrlPaths,
        });
        lineItems = lineItemResult.items;
        lineItemAttempts = lineItemResult.attempts;
      } catch (lineItemError) {
        lineItemAttempts = [
          {
            page: 1,
            status: 500,
            message: lineItemError instanceof Error ? lineItemError.message : String(lineItemError),
          },
        ];
      }

      try {
        const lineItemGroupUrlPaths = [
          ...(resolvedBidBoardProjectId
            ? [
                (page: number, perPage: number) =>
                  `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
                    resolvedBidBoardProjectId
                  )}/proposals/${encodeURIComponent(proposalId)}/line_item_groups?page=${page}&per_page=${perPage}`,
              ]
            : []),
          (page: number, perPage: number) =>
            `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(
              projectId
            )}/estimating/proposals/${encodeURIComponent(proposalId)}/line_item_groups?page=${page}&per_page=${perPage}`,
        ];
        if (bidBoardProjectId) {
          lineItemGroupUrlPaths.push(
            (page: number, perPage: number) =>
              `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
                bidBoardProjectId
              )}/proposals/${encodeURIComponent(proposalId)}/line_item_groups?page=${page}&per_page=${perPage}`
          );
        }

        const lineItemGroupResult = await fetchPagedCollection({
          host,
          accessToken,
          companyId,
          arrayKeys: ["data", "line_item_groups", "groups"],
          urlPaths: lineItemGroupUrlPaths,
        });
        lineItemGroups = lineItemGroupResult.items;
        lineItemGroupAttempts = lineItemGroupResult.attempts;
      } catch (lineItemGroupError) {
        lineItemGroupAttempts = [
          {
            page: 1,
            status: 500,
            message: lineItemGroupError instanceof Error ? lineItemGroupError.message : String(lineItemGroupError),
          },
        ];
      }

      return NextResponse.json({
        success: true,
        source: bidBoardProjectId ? "estimating.proposal_show_full" : "estimating.proposal_show",
        companyId,
        projectId,
        bidBoardProjectId: bidBoardProjectId || null,
        resolvedBidBoardProjectId: resolvedBidBoardProjectId || null,
        proposalId,
        baseUrl: host,
        url,
        summary: {
          ...summarizeProposal(proposal),
          lineItemCount: lineItems.length,
          lineItemGroupCount: lineItemGroups.length,
        },
        proposal,
        raw: payload,
        embeddedLineItemGroups: proposalLineItemGroups,
        embeddedLineItems: proposalLineItems,
        lineItemGroups,
        lineItems,
        lineItemAttempts,
        lineItemGroupAttempts,
      });
    }

    return NextResponse.json(
      {
        error: "Failed to fetch proposal",
        details: "All configured hosts failed",
        attempts,
      },
      { status: 404 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to fetch proposal",
        details: message,
      },
      { status: 500 }
    );
  }
}
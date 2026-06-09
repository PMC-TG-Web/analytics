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

async function fetchPagedCollection(options: {
  host: string;
  accessToken: string;
  companyId: string;
  urlPath: (page: number, perPage: number) => string;
  arrayKeys: string[];
  perPage?: number;
}): Promise<{ items: unknown[]; attempts: Array<{ page: number; status: number; message: string }> }> {
  const items: unknown[] = [];
  const attempts: Array<{ page: number; status: number; message: string }> = [];
  const perPage = Math.min(200, Math.max(1, options.perPage || 200));

  for (let page = 1; page <= 100; page += 1) {
    const url = `${options.host.replace(/\/$/, "")}${options.urlPath(page, perPage)}`;
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
      if (response.status === 404) break;
      throw new Error(`Collection API error ${response.status}: ${errorText || "No response body"}`);
    }

    const payload = (await response.json().catch(() => ({}))) as unknown;
    const pageItems = extractEmbeddedArray(payload, options.arrayKeys);
    if (!pageItems.length) break;

    items.push(...pageItems);
    if (pageItems.length < perPage) break;
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

      if (bidBoardProjectId) {
        try {
          const lineItemResult = await fetchPagedCollection({
            host,
            accessToken,
            companyId,
            arrayKeys: ["data", "line_items", "items"],
            urlPath: (page, perPage) =>
              `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
                bidBoardProjectId
              )}/proposals/${encodeURIComponent(proposalId)}/line_items?page=${page}&per_page=${perPage}`,
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
          const lineItemGroupResult = await fetchPagedCollection({
            host,
            accessToken,
            companyId,
            arrayKeys: ["data", "line_item_groups", "groups"],
            urlPath: (page, perPage) =>
              `/rest/v2.0/companies/${encodeURIComponent(companyId)}/estimating/bid_board_projects/${encodeURIComponent(
                bidBoardProjectId
              )}/proposals/${encodeURIComponent(proposalId)}/line_item_groups?page=${page}&per_page=${perPage}`,
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
      }

      return NextResponse.json({
        success: true,
        source: bidBoardProjectId ? "estimating.proposal_show_full" : "estimating.proposal_show",
        companyId,
        projectId,
        bidBoardProjectId: bidBoardProjectId || null,
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
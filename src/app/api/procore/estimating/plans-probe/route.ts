import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";

const DEFAULT_ESTIMATING_BASE_URL = "https://api.procore.com";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStr(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!isRecord(payload)) return [];

  const candidates = [
    payload.data,
    payload.plans,
    payload.documents,
    payload.files,
    payload.attachments,
    payload.drawings,
    payload.uploads,
    payload.items,
    payload.results,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

function collectMatchingKeys(value: unknown, matcher: (key: string) => boolean, limit = 160): string[] {
  const matches: string[] = [];
  const visited = new Set<unknown>();

  const walk = (current: unknown, path: string) => {
    if (matches.length >= limit) return;
    if (!current || typeof current !== "object") return;
    if (visited.has(current)) return;
    visited.add(current);

    if (Array.isArray(current)) {
      current.slice(0, 10).forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }

    for (const [key, nested] of Object.entries(current as UnknownRecord)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (matcher(key)) {
        matches.push(nextPath);
        if (matches.length >= limit) return;
      }
      walk(nested, nextPath);
    }
  };

  walk(value, "");
  return matches;
}

function summarizePayload(payload: unknown) {
  const rows = extractRows(payload);
  const record = isRecord(payload) ? payload : {};
  return {
    topLevelKeys: Object.keys(record).slice(0, 80),
    rowCount: rows.length,
    sampleRows: rows.slice(0, 5),
    matchedKeys: collectMatchingKeys(payload, (key) =>
      /plan|plans|document|documents|file|files|folder|folders|drawing|drawings|attachment|attachments|upload|uploads|url|download|proposal|takeoff/i.test(
        key
      )
    ),
  };
}

async function getToken(bodyToken: unknown, cookieToken: unknown): Promise<{ accessToken: string; tokenSource: string }> {
  const explicitToken = readStr(bodyToken);
  if (explicitToken) return { accessToken: explicitToken, tokenSource: "body" };

  const cookieAccessToken = readStr(cookieToken);
  if (cookieAccessToken) return { accessToken: cookieAccessToken, tokenSource: "cookie" };

  const serviceToken = await getClientCredentialsToken();
  return { accessToken: serviceToken, tokenSource: "client_credentials" };
}

async function fetchJsonOrText(options: {
  host: string;
  path: string;
  accessToken: string;
  companyId: string;
}) {
  const url = `${options.host.replace(/\/$/, "")}${options.path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        Accept: "application/json",
        "Procore-Company-Id": options.companyId,
      },
      cache: "no-store",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      url,
      status: 0,
      ok: false,
      body: `Fetch failed: ${message}`,
      bodyPreview: `Fetch failed: ${message}`,
    };
  }

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep raw text for diagnostics.
  }

  return {
    url,
    status: response.status,
    ok: response.ok,
    body,
    bodyPreview: typeof body === "string" ? body.slice(0, 1200) : undefined,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const cookieStore = await cookies();

    let accessToken = "";
    let tokenSource = "none";
    try {
      const tokenResult = await getToken(body.accessToken, cookieStore.get("procore_access_token")?.value);
      accessToken = tokenResult.accessToken;
      tokenSource = tokenResult.tokenSource;
    } catch (tokenError) {
      return NextResponse.json(
        {
          error: "Missing access token. Authenticate with Procore first or configure Procore client credentials.",
          details: tokenError instanceof Error ? tokenError.message : String(tokenError),
        },
        { status: 401 }
      );
    }

    const companyId = readStr(
      body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId
    );
    const projectId = readStr(body.projectId || body.project_id);
    const proposalId = readStr(body.proposalId || body.proposal_id);
    const bidBoardProjectId = readStr(body.bidBoardProjectId || body.bid_board_project_id || body.bidBoardId);
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
      extraOrigins: [process.env.PROCORE_ESTIMATING_API_URL, DEFAULT_ESTIMATING_BASE_URL, "https://us02.procore.com"],
    });

    if (hostCandidates.error) {
      return NextResponse.json({ error: hostCandidates.error }, { status: 400 });
    }

    const encodedCompanyId = encodeURIComponent(companyId);
    const encodedProjectId = encodeURIComponent(projectId);
    const encodedProposalId = encodeURIComponent(proposalId);
    const encodedBidBoardProjectId = encodeURIComponent(bidBoardProjectId || projectId);
    const proposalQuery = new URLSearchParams({ proposal_id: proposalId, proposalId });
    const pageQuery = new URLSearchParams({ page: "1", per_page: "100", proposal_id: proposalId, proposalId });

    const candidatePaths = [
      `/tools/bid-board/project/${encodedBidBoardProjectId}?proposalId=${encodedProposalId}`,
      `/tools/bid-board/project/${encodedBidBoardProjectId}/documents?proposalId=${encodedProposalId}`,
      `/tools/bid-board/project/${encodedBidBoardProjectId}/plans?proposalId=${encodedProposalId}`,
      `/webclients/host/companies/${encodedCompanyId}/tools/bid-board/project/${encodedBidBoardProjectId}?proposalId=${encodedProposalId}`,
      `/webclients/host/companies/${encodedCompanyId}/projects/${encodedProjectId}/tools/estimating/plans?proposalId=${encodedProposalId}`,
      `/rest/v2.0/companies/${encodedCompanyId}/tools/bid-board/project/${encodedBidBoardProjectId}/documents?${pageQuery.toString()}`,
      `/rest/v2.0/companies/${encodedCompanyId}/tools/bid-board/project/${encodedBidBoardProjectId}/plans?${pageQuery.toString()}`,
      `/rest/v2.0/companies/${encodedCompanyId}/bid-board/projects/${encodedBidBoardProjectId}/documents?${pageQuery.toString()}`,
      `/rest/v2.0/companies/${encodedCompanyId}/bid-board/projects/${encodedBidBoardProjectId}/plans?${pageQuery.toString()}`,
      `/rest/v2.0/companies/${encodedCompanyId}/estimating/bid_board_projects/${encodedBidBoardProjectId}`,
      `/rest/v2.0/companies/${encodedCompanyId}/estimating/bid_board_projects/${encodedBidBoardProjectId}/documents?${pageQuery.toString()}`,
      `/rest/v2.0/companies/${encodedCompanyId}/estimating/bid_board_projects/${encodedBidBoardProjectId}/plans?${pageQuery.toString()}`,
      `/rest/v2.0/companies/${encodedCompanyId}/estimating/bid_board_projects/${encodedBidBoardProjectId}/proposals/${encodedProposalId}`,
      `/rest/v2.0/companies/${encodedCompanyId}/estimating/bid_board_projects/${encodedBidBoardProjectId}/proposals/${encodedProposalId}/documents?page=1&per_page=100`,
      `/rest/v2.0/companies/${encodedCompanyId}/estimating/bid_board_projects/${encodedBidBoardProjectId}/proposals/${encodedProposalId}/plans?page=1&per_page=100`,
      `/rest/v2.0/companies/${encodedCompanyId}/projects/${encodedProjectId}/estimating/estimating_project`,
      `/rest/v2.0/companies/${encodedCompanyId}/projects/${encodedProjectId}/estimating/proposals/${encodedProposalId}`,
      `/rest/v2.0/companies/${encodedCompanyId}/projects/${encodedProjectId}/estimating/plans?${pageQuery.toString()}`,
      `/rest/v2.0/companies/${encodedCompanyId}/projects/${encodedProjectId}/estimating/documents?${pageQuery.toString()}`,
      `/rest/v2.0/companies/${encodedCompanyId}/projects/${encodedProjectId}/estimating/files?${pageQuery.toString()}`,
      `/rest/v2.0/companies/${encodedCompanyId}/projects/${encodedProjectId}/estimating/uploads?${pageQuery.toString()}`,
      `/rest/v2.0/companies/${encodedCompanyId}/projects/${encodedProjectId}/estimating/takeoffs?${pageQuery.toString()}`,
      `/rest/v2.0/companies/${encodedCompanyId}/projects/${encodedProjectId}/estimating/proposals/${encodedProposalId}/plans?page=1&per_page=100`,
      `/rest/v2.0/companies/${encodedCompanyId}/projects/${encodedProjectId}/estimating/proposals/${encodedProposalId}/documents?page=1&per_page=100`,
      `/rest/v2.0/companies/${encodedCompanyId}/projects/${encodedProjectId}/estimating/proposals/${encodedProposalId}/files?page=1&per_page=100`,
      `/rest/v2.0/companies/${encodedCompanyId}/projects/${encodedProjectId}/estimating/proposals/${encodedProposalId}/uploads?page=1&per_page=100`,
      `/rest/v2.0/companies/${encodedCompanyId}/projects/${encodedProjectId}/estimating/proposals/${encodedProposalId}/takeoffs?page=1&per_page=100`,
      `/rest/v1.0/projects/${encodedProjectId}/estimating/plans?${proposalQuery.toString()}`,
      `/rest/v1.0/projects/${encodedProjectId}/estimating/documents?${proposalQuery.toString()}`,
      `/rest/v1.0/projects/${encodedProjectId}/estimating/proposals/${encodedProposalId}/plans?page=1&per_page=100`,
      `/rest/v1.0/projects/${encodedProjectId}/estimating/proposals/${encodedProposalId}/documents?page=1&per_page=100`,
    ];

    const hostAttempts: Array<{
      host: string;
      endpointAttempts: Array<{
        path: string;
        url: string;
        status: number;
        ok: boolean;
        summary?: ReturnType<typeof summarizePayload>;
        errorPreview?: string;
      }>;
    }> = [];

    for (const host of hostCandidates.candidates) {
      const endpointAttempts: Array<{
        path: string;
        url: string;
        status: number;
        ok: boolean;
        summary?: ReturnType<typeof summarizePayload>;
        errorPreview?: string;
      }> = [];

      for (const path of candidatePaths) {
        try {
          const result = await fetchJsonOrText({
            host,
            path,
            accessToken,
            companyId,
          });

          endpointAttempts.push({
            path,
            url: result.url,
            status: result.status,
            ok: result.ok,
            summary: result.ok ? summarizePayload(result.body) : undefined,
            errorPreview: result.ok
              ? undefined
              : typeof result.body === "string"
                ? result.body.slice(0, 1200)
                : JSON.stringify(result.body).slice(0, 1200),
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          endpointAttempts.push({
            path,
            url: `${host.replace(/\/$/, "")}${path}`,
            status: 0,
            ok: false,
            errorPreview: `Probe attempt failed: ${message}`,
          });
        }
      }

      hostAttempts.push({ host, endpointAttempts });

      const successfulPlanLikeAttempt = endpointAttempts.find((attempt) => {
        if (!attempt.ok) return false;
        const keys = attempt.summary?.matchedKeys || [];
        const path = attempt.path.toLowerCase();
        return (
          /plans|documents|files|uploads|takeoffs/.test(path) ||
          keys.some((key) => /plan|document|file|upload|takeoff/i.test(key))
        );
      });

      if (successfulPlanLikeAttempt) {
        return NextResponse.json({
          success: true,
          source: "estimating.plans_probe",
          companyId,
          projectId,
          proposalId,
          bidBoardProjectId: bidBoardProjectId || null,
          baseUrl: host,
          tokenSource,
          targetHints: {
            planLikeEndpointFound: true,
            planLikePath: successfulPlanLikeAttempt.path,
            nextStep:
              "Use this response to identify the Estimating plans/documents resource before adding a write/upload flow.",
          },
          note:
            "Read-only probe. It tests likely Estimating plans/documents/proposal endpoints without creating or uploading anything.",
          hostAttempts,
        });
      }
    }

    return NextResponse.json({
      success: true,
      source: "estimating.plans_probe",
      companyId,
      projectId,
      proposalId,
      bidBoardProjectId: bidBoardProjectId || null,
      tokenSource,
      targetHints: {
        planLikeEndpointFound: false,
        planLikePath: null,
        nextStep:
          "No obvious public Estimating plans/documents endpoint responded. Inspect successful proposal/estimating_project payload keys, or capture the browser network request from the Upload button.",
      },
      note:
        "Read-only probe completed. No upload was attempted.",
      hostAttempts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: "Failed to probe Estimating plans/documents",
        details: message,
      },
      { status: 500 }
    );
  }
}

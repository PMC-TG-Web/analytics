import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";
import { buildAllowedProcoreHostCandidates } from "@/lib/procoreHosts";

const DEFAULT_ESTIMATING_BASE_URL = "https://api.procore.com";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const cookieStore = await cookies();

    const bodyToken = String(body.accessToken || "").trim();
    const cookieToken = String(cookieStore.get("procore_access_token")?.value || "").trim();
    const accessToken = cookieToken || bodyToken;

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

    const proposalPayload = isRecord(body.proposal)
      ? body.proposal
      : {
          ...(body.name ? { name: String(body.name) } : {}),
          ...(body.description ? { description: String(body.description) } : {}),
        };

    if (Object.keys(proposalPayload).length === 0) {
      return NextResponse.json(
        { error: "Missing required payload: proposal (or at minimum name)." },
        { status: 400 }
      );
    }

    const requestedBaseUrl = String(
      body.baseUrl || process.env.PROCORE_ESTIMATING_API_URL || DEFAULT_ESTIMATING_BASE_URL
    ).trim();

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
      )}/estimating/bid_board_projects/${encodeURIComponent(bidBoardProjectId)}/proposals`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "Procore-Company-Id": companyId,
        },
        body: JSON.stringify(proposalPayload),
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
            error: `Create proposal API error ${response.status}`,
            details: errorText,
            host,
            attemptedPayload: proposalPayload,
          },
          { status: response.status }
        );
      }

      const payload = (await response.json().catch(() => ({}))) as unknown;
      const payloadRecord = isRecord(payload) ? payload : {};
      const createdProposalId = String(payloadRecord.id || payloadRecord.proposal_id || "").trim() || null;

      return NextResponse.json({
        success: true,
        source: "estimating.create_proposal",
        companyId,
        bidBoardProjectId,
        baseUrl: host,
        proposalId: createdProposalId,
        proposal: payload,
      });
    }

    return NextResponse.json(
      {
        error: "Failed to create proposal",
        details: "All configured hosts failed",
        attempts,
      },
      { status: 404 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to create proposal",
        details: message,
      },
      { status: 500 }
    );
  }
}

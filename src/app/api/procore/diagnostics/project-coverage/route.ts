import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";

const DEFAULT_ESTIMATING_BASE_URL =
  "https://estimating-esticom-829a58c093c92de.na-east-01-tugboat.procoretech-qa.com";

type V1Project = {
  id?: number | string;
  name?: string;
  display_name?: string;
  project_number?: string;
};

type CoverageRow = {
  id: string;
  name: string;
  displayName: string;
  projectNumber: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      accessToken: bodyToken,
      companyId: companyIdFromBody,
      perPage = 100,
      maxMissingRows = 200,
      baseUrl = process.env.PROCORE_ESTIMATING_API_URL || DEFAULT_ESTIMATING_BASE_URL,
    } = body;

    const cookieStore = await cookies();
    const cookieToken = cookieStore.get("procore_access_token")?.value;
    const accessToken = cookieToken || bodyToken;

    if (!accessToken) {
      return NextResponse.json(
        {
          error:
            "Missing access token. Please authenticate via OAuth first or provide accessToken in request body.",
        },
        { status: 401 }
      );
    }

    const companyId = String(companyIdFromBody || procoreConfig.companyId || "").trim();
    if (!companyId) {
      return NextResponse.json(
        { error: "Missing companyId. Set PROCORE_COMPANY_ID or provide companyId in request body." },
        { status: 400 }
      );
    }

    const safePerPage = Math.min(Math.max(Number(perPage) || 100, 1), 200);
    const safeMaxMissingRows = Math.min(Math.max(Number(maxMissingRows) || 200, 1), 2000);

    // Fetch all v1 projects
    const v1Projects: V1Project[] = [];
    let v1Page = 1;
    while (true) {
      const endpoint = `/rest/v1.0/projects?company_id=${encodeURIComponent(
        companyId
      )}&page=${v1Page}&per_page=${safePerPage}`;

      const pageRows = (await makeRequest(endpoint, accessToken)) as unknown;
      if (!Array.isArray(pageRows) || pageRows.length === 0) break;

      v1Projects.push(...(pageRows as V1Project[]));
      if (pageRows.length < safePerPage) break;
      v1Page += 1;
    }

    // Fetch all v2 bid board rows with host fallback
    const hostCandidates = Array.from(
      new Set(
        [
          String(baseUrl || "").trim(),
          String(process.env.PROCORE_ESTIMATING_API_URL || "").trim(),
          DEFAULT_ESTIMATING_BASE_URL,
          "https://api.procore.com",
        ].filter(Boolean)
      )
    );

    const attempts: Array<{ host: string; status: number; message: string }> = [];
    let successfulHost = "";
    const bidBoardIds = new Set<string>();

    for (const host of hostCandidates) {
      let page = 1;
      let hostWorked = false;
      const hostIds = new Set<string>();

      while (true) {
        const params = new URLSearchParams({
          page: String(page),
          per_page: String(safePerPage),
        });

        const url = `${host.replace(/\/$/, "")}/rest/v2.0/companies/${encodeURIComponent(
          companyId
        )}/estimating/bid_board_projects?${params.toString()}`;

        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${String(accessToken).trim()}`,
            Accept: "application/json",
            "Procore-Company-Id": companyId,
          },
        });

        if (!response.ok) {
          const errorBody = await response.text();
          attempts.push({
            host,
            status: response.status,
            message: errorBody || "No response body",
          });

          if (response.status === 404) break;
          throw new Error(`Bid board API error ${response.status} from ${host}: ${errorBody}`);
        }

        hostWorked = true;
        const json = await response.json();
        const rows = Array.isArray(json)
          ? json
          : Array.isArray((json as { data?: unknown[] }).data)
          ? (json as { data: unknown[] }).data
          : [];

        for (const row of rows) {
          const rowId = (row as { id?: string | number }).id;
          if (rowId !== undefined && rowId !== null) {
            hostIds.add(String(rowId));
          }
        }

        if (rows.length < safePerPage) break;
        page += 1;
      }

      if (hostWorked) {
        successfulHost = host;
        for (const id of hostIds) bidBoardIds.add(id);
        break;
      }
    }

    const v1IdMap = new Map<string, V1Project>();
    for (const project of v1Projects) {
      if (project.id !== undefined && project.id !== null) {
        v1IdMap.set(String(project.id), project);
      }
    }

    const allProjectIds = new Set(v1IdMap.keys());

    const missingInBidBoard: CoverageRow[] = [];
    for (const id of allProjectIds) {
      if (!bidBoardIds.has(id)) {
        const row = v1IdMap.get(id);
        missingInBidBoard.push({
          id,
          name: String(row?.name || ""),
          displayName: String(row?.display_name || ""),
          projectNumber: String(row?.project_number || ""),
        });
      }
    }

    const onlyInBidBoard: string[] = [];
    for (const id of bidBoardIds) {
      if (!allProjectIds.has(id)) {
        onlyInBidBoard.push(id);
      }
    }

    return NextResponse.json({
      success: true,
      companyId,
      successfulBidBoardHost: successfulHost || null,
      attemptedHosts: hostCandidates,
      attempts,
      counts: {
        allProjectsV1: allProjectIds.size,
        bidBoardV2: bidBoardIds.size,
        missingInBidBoard: missingInBidBoard.length,
        onlyInBidBoard: onlyInBidBoard.length,
      },
      missingInBidBoard: missingInBidBoard.slice(0, safeMaxMissingRows),
      onlyInBidBoard: onlyInBidBoard.slice(0, safeMaxMissingRows),
      notes:
        "missingInBidBoard are projects visible in /rest/v1.0/projects but not present in estimating bid_board_projects for this token/company.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Procore project coverage diagnostics error:", message);

    return NextResponse.json(
      {
        error: "Failed to compare project coverage",
        details: message,
      },
      { status: 500 }
    );
  }
}

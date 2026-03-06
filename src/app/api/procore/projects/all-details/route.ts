import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";

type ProcoreProjectSummary = {
  id?: number | string;
  [key: string]: unknown;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      accessToken: bodyToken,
      companyId: companyIdFromBody,
      view = "normal",
      perPage = 100,
      maxProjects,
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
        { error: "Missing companyId. Set PROCORE_COMPANY_ID or send companyId in request body." },
        { status: 400 }
      );
    }

    const safePerPage = Math.min(Math.max(Number(perPage) || 100, 1), 200);
    const cappedMaxProjects =
      typeof maxProjects === "number" && maxProjects > 0 ? Math.floor(maxProjects) : null;

    const projects: ProcoreProjectSummary[] = [];
    let page = 1;

    while (true) {
      const endpoint = `/rest/v1.0/projects?company_id=${encodeURIComponent(
        companyId
      )}&page=${page}&per_page=${safePerPage}`;

      const pageData = await makeRequest(endpoint, accessToken);
      if (!Array.isArray(pageData) || pageData.length === 0) {
        break;
      }

      projects.push(...(pageData as ProcoreProjectSummary[]));

      if (cappedMaxProjects && projects.length >= cappedMaxProjects) {
        break;
      }

      if (pageData.length < safePerPage) {
        break;
      }

      page += 1;
    }

    const targetProjects = cappedMaxProjects ? projects.slice(0, cappedMaxProjects) : projects;

    const details: unknown[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const project of targetProjects) {
      const id = project.id;
      if (id === undefined || id === null) {
        continue;
      }

      const endpoint = `/rest/v1.0/projects/${encodeURIComponent(
        String(id)
      )}?company_id=${encodeURIComponent(companyId)}&view=${encodeURIComponent(view)}`;

      try {
        const data = await makeRequest(endpoint, accessToken);
        details.push(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        failed.push({ id: String(id), error: message });
      }
    }

    return NextResponse.json({
      success: true,
      companyId,
      view,
      totalProjectsFound: projects.length,
      totalRequested: targetProjects.length,
      totalDetailsFetched: details.length,
      totalFailed: failed.length,
      failed,
      projects: details,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Procore all project details API error:", message);

    return NextResponse.json(
      {
        error: "Failed to fetch all Procore project details",
        details: message,
      },
      { status: 500 }
    );
  }
}

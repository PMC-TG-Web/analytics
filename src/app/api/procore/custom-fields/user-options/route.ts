import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";
import { getCanonicalProjectIdsForCompany } from "@/lib/procoreCanonicalProjectIds";

export const dynamic = "force-dynamic";

const MAX_ALL_PROJECTS_SCAN = 250;

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

function toPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function toOptionIdentity(option: unknown): string {
  if (!option || typeof option !== "object") return "";
  const row = option as Record<string, unknown>;
  const id = readText(row.id);
  const name = readText(row.name);
  const value = readText(row.value);
  return `${id}::${name}::${value}`;
}

function unwrapItems(payload: unknown): unknown[] {
  return Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown[] }).data)
      ? ((payload as { data: unknown[] }).data || [])
      : [];
}

const COMMON_TOOL_NAME_HINTS = [
  "bidding",
  "budget",
  "commitments",
  "correspondence",
  "daily_log",
  "documents",
  "inspections",
  "meetings",
  "observations",
  "prime_contract",
  "rfis",
  "schedule",
  "submittals",
];

function isInvalidToolNameError(message: string): boolean {
  return /invalid tool name/i.test(message);
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    const cookieStore = await cookies();
    const cookieToken = cookieStore.get("procore_access_token")?.value;
    const accessToken = readText(cookieToken || body?.accessToken);

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: "Missing access token. Please authenticate via OAuth first." },
        { status: 401 }
      );
    }

    const projectId = readText(body?.projectId);
    const toolName = readText(body?.toolName);
    const companyId = readText(
      body?.companyId ||
        cookieStore.get("procore_company_id")?.value ||
        procoreConfig.companyId ||
        ""
    );
    const search = readText(body?.search);
    const page = toPositiveInt(body?.page, 1, 1, 1000);
    const perPage = toPositiveInt(body?.perPage, 100, 1, 1000);
    const allProjects = body?.allProjects === true;
    const limitProjects = toPositiveInt(body?.limitProjects, 250, 1, MAX_ALL_PROJECTS_SCAN);

    if (!allProjects && !projectId) {
      return NextResponse.json({ success: false, error: "Missing projectId" }, { status: 400 });
    }

    if (!toolName) {
      return NextResponse.json({ success: false, error: "Missing toolName" }, { status: 400 });
    }

    const qs = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
    });
    if (search) qs.set("filters[search]", search);

    if (allProjects) {
      const projectIds = await getCanonicalProjectIdsForCompany(companyId, limitProjects);

      if (projectIds.length === 0) {
        return NextResponse.json({
          success: true,
          allProjects: true,
          toolName,
          companyId,
          search,
          page,
          perPage,
          projectsScanned: 0,
          projectsSucceeded: 0,
          projectsFailed: 0,
          totalOptionsFetched: 0,
          uniqueOptions: 0,
          count: 0,
          data: [],
          projectSummaries: [],
          errors: [],
        });
      }

      // Validate tool_name once up front so we don't spam per-project errors.
      try {
        const probeEndpoint = `/rest/v1.0/projects/${encodeURIComponent(projectIds[0])}/custom_fields/${encodeURIComponent(toolName)}/user_options?${qs.toString()}`;
        await makeRequest(probeEndpoint, accessToken, undefined, companyId);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (isInvalidToolNameError(message)) {
          return NextResponse.json(
            {
              success: false,
              error: "Invalid tool name for Procore custom field user options endpoint.",
              details: message,
              toolName,
              suggestions: COMMON_TOOL_NAME_HINTS,
            },
            { status: 400 }
          );
        }
        throw error;
      }

      const uniqueByIdentity = new Map<string, unknown>();
      const projectSummaries: Array<{ projectId: string; count: number }> = [];
      const errors: Array<{ projectId: string; error: string }> = [];
      let totalOptionsFetched = 0;
      let projectsSucceeded = 0;

      for (const pid of projectIds) {
        try {
          const endpoint = `/rest/v1.0/projects/${encodeURIComponent(pid)}/custom_fields/${encodeURIComponent(toolName)}/user_options?${qs.toString()}`;
          const payload = await makeRequest(endpoint, accessToken, undefined, companyId);
          const items = unwrapItems(payload);

          totalOptionsFetched += items.length;
          projectsSucceeded += 1;
          projectSummaries.push({ projectId: pid, count: items.length });

          for (const item of items) {
            const identity = toOptionIdentity(item);
            if (!identity) continue;
            if (!uniqueByIdentity.has(identity)) {
              uniqueByIdentity.set(identity, item);
            }
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : "Unknown error";
          errors.push({ projectId: pid, error: message });
        }
      }

      const uniqueItems = [...uniqueByIdentity.values()];

      return NextResponse.json({
        success: true,
        allProjects: true,
        toolName,
        companyId,
        search,
        page,
        perPage,
        limitProjects,
        projectsScanned: projectIds.length,
        projectsSucceeded,
        projectsFailed: errors.length,
        totalOptionsFetched,
        uniqueOptions: uniqueItems.length,
        count: uniqueItems.length,
        data: uniqueItems,
        projectSummaries,
        errors,
      });
    }

    const endpoint = `/rest/v1.0/projects/${encodeURIComponent(projectId)}/custom_fields/${encodeURIComponent(toolName)}/user_options?${qs.toString()}`;
    let payload: unknown;
    try {
      payload = await makeRequest(endpoint, accessToken, undefined, companyId);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (isInvalidToolNameError(message)) {
        return NextResponse.json(
          {
            success: false,
            error: "Invalid tool name for Procore custom field user options endpoint.",
            details: message,
            toolName,
            suggestions: COMMON_TOOL_NAME_HINTS,
          },
          { status: 400 }
        );
      }
      throw error;
    }
    const items = unwrapItems(payload);

    return NextResponse.json({
      success: true,
      allProjects: false,
      projectId,
      toolName,
      companyId,
      search,
      page,
      perPage,
      count: items.length,
      data: items,
      raw: payload,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch custom field user options", details: message },
      { status: 500 }
    );
  }
}

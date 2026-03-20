import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";
import {
  normalizeDate,
  persistProductivityLogs,
  type ProcoreLog,
} from "@/lib/procoreProductivity";

type ProcoreProject = Record<string, unknown>;

function parseCsv(value: unknown): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }

  return "";
}

async function fetchAllProjects(accessToken: string, companyId: string, maxProjects?: number) {
  const projects: ProcoreProject[] = [];
  const perPage = 100;
  let page = 1;

  while (true) {
    const endpoint = `/rest/v1.0/projects?company_id=${encodeURIComponent(companyId)}&page=${page}&per_page=${perPage}`;
    const response = await makeRequest(endpoint, accessToken, undefined, companyId);
    const pageItems = Array.isArray(response) ? (response as ProcoreProject[]) : [];

    if (!pageItems.length) {
      break;
    }

    projects.push(...pageItems);

    if ((maxProjects || 0) > 0 && projects.length >= (maxProjects || 0)) {
      return projects.slice(0, maxProjects);
    }

    if (pageItems.length < perPage) {
      break;
    }

    page += 1;
    if (page > 100) break;
  }

  return projects;
}

async function fetchAllProductivityLogsForProject(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  logDate?: string;
  startDate?: string;
  endDate?: string;
  createdByIds?: string[];
  dailyLogSegmentId?: string;
  perPage: number;
}) {
  const logs: ProcoreLog[] = [];
  let page = 1;

  while (true) {
    const query = new URLSearchParams();
    if (params.logDate) query.set("log_date", params.logDate);
    if (params.startDate) query.set("start_date", params.startDate);
    if (params.endDate) query.set("end_date", params.endDate);
    if (params.createdByIds?.length) {
      query.set("filters[created_by_id]", params.createdByIds.join(","));
    }
    if (params.dailyLogSegmentId) {
      query.set("filters[daily_log_segment_id]", params.dailyLogSegmentId);
    }
    query.set("page", String(page));
    query.set("per_page", String(params.perPage));

    const endpoint = `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/productivity_logs?${query.toString()}`;
    const response = await makeRequest(endpoint, params.accessToken, undefined, params.companyId);
    const pageLogs = Array.isArray(response) ? (response as ProcoreLog[]) : [];

    if (!pageLogs.length) {
      break;
    }

    logs.push(...pageLogs);

    if (pageLogs.length < params.perPage) {
      break;
    }

    page += 1;
    if (page > 100) break;
  }

  return logs;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, () => runner())
  );

  return results;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const cookieStore = await cookies();
    const accessToken =
      cookieStore.get("procore_access_token")?.value || String(body.accessToken || "").trim() || undefined;
    const companyId = String(
      body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId || ""
    ).trim();

    if (!accessToken) {
      return NextResponse.json(
        {
          error: "Missing access token. Please authenticate via OAuth first or provide accessToken.",
          connectUrl: "/api/auth/procore/login",
        },
        { status: 401 }
      );
    }

    if (!companyId) {
      return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    }

    const startDate = normalizeDate(body.startDate || body.start_date) || "2025-08-01";
    const endDate = normalizeDate(body.endDate || body.end_date) || new Date().toISOString().split("T")[0];
    const logDate = normalizeDate(body.logDate || body.log_date);
    const createdByIds = Array.isArray(body.createdByIds)
      ? body.createdByIds.map((value) => String(value).trim()).filter(Boolean)
      : parseCsv(body.createdByIds);
    const dailyLogSegmentId = String(body.dailyLogSegmentId || body["filters[daily_log_segment_id]"] || "").trim() || undefined;
    const perPage = Math.min(200, Math.max(1, Number.parseInt(String(body.perPage || body.per_page || "100"), 10) || 100));
    const concurrency = Math.min(8, Math.max(1, Number.parseInt(String(body.concurrency || "4"), 10) || 4));
    const maxProjects = Math.max(0, Number.parseInt(String(body.maxProjects || "0"), 10) || 0);
    const persist = body.persist === undefined ? true : Boolean(body.persist);

    const projects = await fetchAllProjects(accessToken, companyId, maxProjects || undefined);

    const summary = {
      success: true,
      companyId,
      totalProjectsChecked: projects.length,
      projectsWithActivity: 0,
      totalLogsFetched: 0,
      totalLogsSaved: 0,
      totalProjectsCreated: 0,
      activeProjects: [] as Array<{
        projectId: string;
        projectNumber: string | null;
        projectName: string;
        logCount: number;
        savedCount: number;
        skippedCount: number;
        projectCreated: boolean;
        linkedProjectId: string | null;
      }>,
      errors: [] as string[],
    };

    await mapWithConcurrency(projects, concurrency, async (project) => {
      const projectObject = asObject(project);
      const projectId = firstText(projectObject.id);
      if (!projectId) {
        return;
      }

      const projectNumber = firstText(projectObject.project_number, projectObject.number) || null;
      const projectName = firstText(projectObject.name, projectObject.display_name, projectObject.project_name) || `Procore Project ${projectId}`;

      try {
        const logs = await fetchAllProductivityLogsForProject({
          accessToken,
          companyId,
          projectId,
          logDate,
          startDate,
          endDate,
          createdByIds,
          dailyLogSegmentId,
          perPage,
        });

        if (!logs.length) {
          return;
        }

        const persistence = persist
          ? await persistProductivityLogs(logs, {
              companyId,
              projectId,
              projectName,
              projectNumber: projectNumber || undefined,
              createProjectIfMissing: true,
            })
          : {
              attempted: 0,
              saved: 0,
              skipped: 0,
              projectLinked: false,
              projectCreated: false,
              linkedProjectId: null,
            };

        summary.projectsWithActivity += 1;
        summary.totalLogsFetched += logs.length;
        summary.totalLogsSaved += persistence.saved;
        if (persistence.projectCreated) {
          summary.totalProjectsCreated += 1;
        }

        summary.activeProjects.push({
          projectId,
          projectNumber,
          projectName,
          logCount: logs.length,
          savedCount: persistence.saved,
          skippedCount: persistence.skipped,
          projectCreated: persistence.projectCreated,
          linkedProjectId: persistence.linkedProjectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        summary.errors.push(`${projectId} (${projectName}): ${message}`);
      }
    });

    summary.activeProjects.sort((left, right) => right.logCount - left.logCount);

    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Procore productivity project sync error:", message);

    return NextResponse.json(
      {
        error: "Failed to sync projects with Procore productivity activity",
        details: message,
      },
      { status: 500 }
    );
  }
}
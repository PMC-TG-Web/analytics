import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";
import {
  persistCommitmentContracts,
  type ProcoreCommitmentContract,
} from "@/lib/procoreCommitmentContracts";

type ProcoreProject = Record<string, unknown>;

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

function isNotFoundError(err: unknown): boolean {
  const status = Number((err as { status?: number })?.status || 0);
  if (status === 404) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /(?:^|\D)404(?:\D|$)/.test(msg);
}

async function fetchAllProjects(accessToken: string, companyId: string, maxProjects?: number) {
  const projects: ProcoreProject[] = [];
  const perPage = 100;
  let page = 1;
  while (true) {
    const endpoint = `/rest/v1.0/projects?company_id=${encodeURIComponent(companyId)}&page=${page}&per_page=${perPage}`;
    const response = await makeRequest(endpoint, accessToken, undefined, companyId);
    const pageItems = Array.isArray(response) ? (response as ProcoreProject[]) : [];
    if (!pageItems.length) break;
    projects.push(...pageItems);
    if ((maxProjects || 0) > 0 && projects.length >= (maxProjects || 0)) return projects.slice(0, maxProjects);
    if (pageItems.length < perPage) break;
    page += 1;
    if (page > 100) break;
  }
  return projects;
}

function unwrapRecords(response: unknown): ProcoreCommitmentContract[] {
  if (Array.isArray(response)) return response as ProcoreCommitmentContract[];
  // Procore v2 may wrap in { data: [...] }
  if (response && typeof response === "object") {
    const r = response as Record<string, unknown>;
    if (Array.isArray(r.data)) return r.data as ProcoreCommitmentContract[];
    if (Array.isArray(r.commitment_contracts)) return r.commitment_contracts as ProcoreCommitmentContract[];
    if (Array.isArray(r.results)) return r.results as ProcoreCommitmentContract[];
  }
  return [];
}

async function fetchAllContractsForProject(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  perPage: number;
}): Promise<{ records: ProcoreCommitmentContract[]; notEnabled: boolean }> {
  const records: ProcoreCommitmentContract[] = [];
  let page = 1;
  while (true) {
    const query = new URLSearchParams();
    query.set("page", String(page));
    query.set("per_page", String(params.perPage));
    const endpoint = `/rest/v2.0/companies/${encodeURIComponent(params.companyId)}/projects/${encodeURIComponent(params.projectId)}/commitment_contracts?${query.toString()}`;
    let response: unknown;
    try {
      response = await makeRequest(endpoint, params.accessToken, undefined, params.companyId);
    } catch (err) {
      // 404 = tool not enabled on this project — silently skip
      if (isNotFoundError(err)) return { records: [], notEnabled: true };
      throw err;
    }
    const pageRecords = unwrapRecords(response);
    console.log(`[CommitmentContracts] project=${params.projectId} page=${page} count=${pageRecords.length}`);
    if (!pageRecords.length) break;
    records.push(...pageRecords);
    if (pageRecords.length < params.perPage) break;
    page += 1;
    if (page > 100) break;
  }
  return { records, notEnabled: false };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function runner() {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, () => runner()));
  return results;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const cookieStore = await cookies();
    const accessToken =
      cookieStore.get("procore_access_token")?.value ||
      String(body.accessToken || "").trim() ||
      undefined;
    const companyId = String(
      body.companyId || cookieStore.get("procore_company_id")?.value || procoreConfig.companyId || ""
    ).trim();

    if (!accessToken) {
      return NextResponse.json({ error: "Missing access token.", connectUrl: "/api/auth/procore/login" }, { status: 401 });
    }
    if (!companyId) {
      return NextResponse.json({ error: "Missing companyId" }, { status: 400 });
    }

    const perPage = Math.min(200, Math.max(1, Number.parseInt(String(body.perPage || "100"), 10) || 100));
    const concurrency = Math.min(8, Math.max(1, Number.parseInt(String(body.concurrency || "2"), 10) || 2));
    const maxProjects = Math.max(0, Number.parseInt(String(body.maxProjects || "0"), 10) || 0);
    const persist = body.persist === undefined ? true : Boolean(body.persist);

    const projects = await fetchAllProjects(accessToken, companyId, maxProjects || undefined);

    const summary = {
      success: true,
      companyId,
      totalProjectsChecked: projects.length,
      projectsWithContracts: 0,
      totalContractsFetched: 0,
      totalContractsSaved: 0,
      totalProjectsCreated: 0,
      activeProjects: [] as Array<{
        projectId: string;
        projectNumber: string | null;
        projectName: string;
        contractCount: number;
        savedCount: number;
        skippedCount: number;
        projectCreated: boolean;
        linkedProjectId: string | null;
      }>,
      errors: [] as string[],
    };

    await mapWithConcurrency(projects, concurrency, async (project) => {
      const projectId = String(asObject(project).id ?? asObject(project).project_id ?? "").trim();
      if (!projectId) return;

      const projectNumber = firstText(asObject(project).project_number, asObject(project).number);
      const projectName = firstText(asObject(project).name, asObject(project).project_name, `Procore Project ${projectId}`);

      try {
        const { records, notEnabled } = await fetchAllContractsForProject({ accessToken: accessToken!, companyId, projectId, perPage });
        if (notEnabled || !records.length) return;

        summary.totalContractsFetched += records.length;
        summary.projectsWithContracts += 1;

        let savedCount = 0;
        let skippedCount = 0;
        let projectCreated = false;
        let linkedProjectId: string | null = null;

        if (persist) {
          const result = await persistCommitmentContracts(records, {
            companyId, projectId, projectName, projectNumber: projectNumber || undefined, createProjectIfMissing: true,
          });
          savedCount = result.saved;
          skippedCount = result.skipped;
          projectCreated = result.projectCreated;
          linkedProjectId = result.linkedProjectId;
          summary.totalContractsSaved += result.saved;
          if (projectCreated) summary.totalProjectsCreated += 1;
        } else {
          savedCount = records.length;
        }

        summary.activeProjects.push({ projectId, projectNumber: projectNumber || null, projectName, contractCount: records.length, savedCount, skippedCount, projectCreated, linkedProjectId });
      } catch (err) {
        summary.errors.push(`Project ${projectId} (${projectName}): ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

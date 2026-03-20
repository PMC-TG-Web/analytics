import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";
import {
  persistChangeOrderLineItems,
  type ProcoreChangeOrder,
  type ProcoreChangeOrderLineItem,
} from "@/lib/procoreChangeOrderLineItems";

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

function unwrapArray(response: unknown): unknown[] {
  if (Array.isArray(response)) return response;
  if (response && typeof response === "object") {
    const r = response as Record<string, unknown>;
    if (Array.isArray(r.data)) return r.data;
    if (Array.isArray(r.results)) return r.results;
  }
  return [];
}

function isNotFoundError(err: unknown): boolean {
  const status = Number((err as { status?: number })?.status || 0);
  if (status === 404) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /(?:^|\D)404(?:\D|$)/.test(msg);
}

async function fetchAllProjects(accessToken: string, companyId: string, maxProjects?: number) {
  const projects: ProcoreProject[] = [];
  let page = 1;
  while (true) {
    const endpoint = `/rest/v1.0/projects?company_id=${encodeURIComponent(companyId)}&page=${page}&per_page=100`;
    const response = await makeRequest(endpoint, accessToken, undefined, companyId);
    const pageItems = Array.isArray(response) ? (response as ProcoreProject[]) : [];
    if (!pageItems.length) break;
    projects.push(...pageItems);
    if ((maxProjects || 0) > 0 && projects.length >= (maxProjects || 0)) return projects.slice(0, maxProjects);
    if (pageItems.length < 100) break;
    page += 1;
    if (page > 100) break;
  }
  return projects;
}

async function fetchChangeOrdersForProject(accessToken: string, companyId: string, projectId: string, perPage: number) {
  const records: ProcoreChangeOrder[] = [];
  let page = 1;
  while (true) {
    const endpoint = `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/commitment_change_orders?page=${page}&per_page=${perPage}`;
    let response: unknown;
    try {
      response = await makeRequest(endpoint, accessToken, undefined, companyId);
    } catch (err) {
      if (isNotFoundError(err)) return { records: [], notEnabled: true };
      throw err;
    }
    const pageRecords = unwrapArray(response) as ProcoreChangeOrder[];
    if (!pageRecords.length) break;
    records.push(...pageRecords);
    if (pageRecords.length < perPage) break;
    page += 1;
    if (page > 100) break;
  }
  return { records, notEnabled: false };
}

async function fetchLineItemsForChangeOrder(
  accessToken: string,
  companyId: string,
  projectId: string,
  changeOrderId: string,
  perPage: number
) {
  const records: ProcoreChangeOrderLineItem[] = [];
  let page = 1;
  while (true) {
    const endpoint = `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encodeURIComponent(projectId)}/commitment_change_orders/${encodeURIComponent(changeOrderId)}/line_items?page=${page}&per_page=${perPage}`;
    let response: unknown;
    try {
      response = await makeRequest(endpoint, accessToken, undefined, companyId);
    } catch (err) {
      if (isNotFoundError(err)) return [];
      throw err;
    }
    const pageRecords = unwrapArray(response) as ProcoreChangeOrderLineItem[];
    if (!pageRecords.length) break;
    records.push(...pageRecords);
    if (pageRecords.length < perPage) break;
    page += 1;
    if (page > 100) break;
  }
  return records;
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
      projectsWithChangeOrders: 0,
      projectsNotEnabled: 0,
      projectsWithoutChangeOrders: 0,
      totalChangeOrdersFetched: 0,
      totalLineItemsFetched: 0,
      totalLineItemsSaved: 0,
      totalProjectsCreated: 0,
      activeProjects: [] as Array<{
        projectId: string;
        projectNumber: string | null;
        projectName: string;
        changeOrderCount: number;
        lineItemCount: number;
        savedCount: number;
        projectCreated: boolean;
        status: string;
      }>,
      errors: [] as string[],
    };

    await mapWithConcurrency(projects, concurrency, async (project) => {
      const projectId = String(asObject(project).id ?? "").trim();
      if (!projectId) return;

      const projectNumber = firstText(asObject(project).project_number, asObject(project).number);
      const projectName = firstText(asObject(project).name, asObject(project).project_name, `Procore Project ${projectId}`);

      try {
        const { records: changeOrders, notEnabled } = await fetchChangeOrdersForProject(accessToken!, companyId, projectId, perPage);
        if (notEnabled) {
          summary.projectsNotEnabled += 1;
          summary.activeProjects.push({
            projectId,
            projectNumber: projectNumber || null,
            projectName,
            changeOrderCount: 0,
            lineItemCount: 0,
            savedCount: 0,
            projectCreated: false,
            status: "Not enabled (404)",
          });
          return;
        }

        if (!changeOrders.length) {
          summary.projectsWithoutChangeOrders += 1;
          summary.activeProjects.push({
            projectId,
            projectNumber: projectNumber || null,
            projectName,
            changeOrderCount: 0,
            lineItemCount: 0,
            savedCount: 0,
            projectCreated: false,
            status: "No change orders",
          });
          return;
        }

        summary.projectsWithChangeOrders += 1;
        summary.totalChangeOrdersFetched += changeOrders.length;

        let totalLineItems = 0;
        let totalSaved = 0;
        let projectCreated = false;

        for (const changeOrder of changeOrders) {
          const rawCoId = String(asObject(changeOrder).id ?? "").trim();
          if (!rawCoId) continue;

          const lineItems = await fetchLineItemsForChangeOrder(accessToken!, companyId, projectId, rawCoId, perPage);
          totalLineItems += lineItems.length;
          summary.totalLineItemsFetched += lineItems.length;

          if (persist && lineItems.length > 0) {
            const result = await persistChangeOrderLineItems(changeOrder, lineItems, {
              companyId, projectId, projectName, projectNumber: projectNumber || undefined, createProjectIfMissing: true,
            });
            totalSaved += result.saved;
            summary.totalLineItemsSaved += result.saved;
            if (result.projectCreated) {
              projectCreated = true;
              summary.totalProjectsCreated += 1;
            }
          } else if (!persist) {
            totalSaved += lineItems.length;
          }
        }

        summary.activeProjects.push({
          projectId,
          projectNumber: projectNumber || null,
          projectName,
          changeOrderCount: changeOrders.length,
          lineItemCount: totalLineItems,
          savedCount: totalSaved,
          projectCreated,
          status: totalLineItems > 0 ? "Synced" : "No line items",
        });
      } catch (err) {
        summary.errors.push(`Project ${projectId} (${projectName}): ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

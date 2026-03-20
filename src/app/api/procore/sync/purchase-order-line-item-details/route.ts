import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest, procoreConfig } from "@/lib/procore";
import {
  persistPurchaseOrderLineItemDetails,
  type ProcoreLineItemContractDetail,
  type ProcorePurchaseOrderContract,
} from "@/lib/procorePurchaseOrderLineItemDetails";

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

function isIgnorableProbeError(err: unknown): boolean {
  const status = Number((err as { status?: number })?.status || 0);
  const msg = err instanceof Error ? err.message : String(err);
  if (
    status === 400 &&
    msg.includes("BAD_REQUEST") &&
    msg.toLowerCase().includes("missing project or company id")
  ) {
    return true;
  }

  // Some unsupported endpoint variants respond with a generic 500 in Procore.
  if (
    status === 500 &&
    msg.toLowerCase().includes("internal server error")
  ) {
    return true;
  }

  return false;
}

function pageSignature(records: Array<Record<string, unknown>>): string {
  if (!records.length) return "empty";
  const first = asObject(records[0]);
  const last = asObject(records[records.length - 1]);
  return [
    records.length,
    String(first.id ?? ""),
    String(first.updated_at ?? ""),
    String(last.id ?? ""),
    String(last.updated_at ?? ""),
  ].join("|");
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

async function fetchPurchaseOrderContractsForProject(
  accessToken: string,
  companyId: string,
  projectId: string,
  perPage: number
): Promise<{ records: ProcorePurchaseOrderContract[]; notEnabled: boolean }> {
  const records: ProcorePurchaseOrderContract[] = [];
  let page = 1;
  let previousSignature = "";

  while (true) {
    const endpoint = `/rest/v1.0/purchase_order_contracts?company_id=${encodeURIComponent(companyId)}&project_id=${encodeURIComponent(projectId)}&page=${page}&per_page=${perPage}`;
    let response: unknown;
    try {
      response = await makeRequest(endpoint, accessToken, undefined, companyId);
    } catch (err) {
      if (isNotFoundError(err)) return { records: [], notEnabled: true };
      throw err;
    }

    const pageRecords = unwrapArray(response) as ProcorePurchaseOrderContract[];
    const signature = pageSignature(pageRecords as Array<Record<string, unknown>>);
    if (signature && signature === previousSignature) {
      console.warn(`[PO Sync] Repeated contracts page detected for project ${projectId} at page ${page}; stopping pagination.`);
      break;
    }
    previousSignature = signature;

    if (!pageRecords.length) break;
    records.push(...pageRecords);
    if (pageRecords.length < perPage) break;
    page += 1;
    if (page > 100) break;
  }

  return { records, notEnabled: false };
}

async function fetchLineItemContractDetailsForContract(
  accessToken: string,
  companyId: string,
  projectId: string,
  purchaseOrderContractId: string,
  perPage: number
): Promise<{ records: ProcoreLineItemContractDetail[]; notEnabled: boolean }> {
  const encProjectId = encodeURIComponent(projectId);
  const encContractId = encodeURIComponent(purchaseOrderContractId);

  function candidateEndpoints(page: number) {
    const encCompanyId = encodeURIComponent(companyId);
    return [
      `/rest/v1.0/purchase_order_contracts/${encContractId}/line_item_contract_details?company_id=${encCompanyId}&project_id=${encProjectId}&page=${page}&per_page=${perPage}`,
      `/rest/v1.0/purchase_order_contracts/${encContractId}/line_item_contract_details?company_id=${encCompanyId}&page=${page}&per_page=${perPage}`,
      `/rest/v1.0/projects/${encProjectId}/purchase_order_contracts/${encContractId}/line_item_contract_details?company_id=${encCompanyId}&page=${page}&per_page=${perPage}`,
      `/rest/v1.0/purchase_order_contracts/${encContractId}/line_items?company_id=${encCompanyId}&project_id=${encProjectId}&page=${page}&per_page=${perPage}`,
      `/rest/v1.0/purchase_order_contracts/${encContractId}/line_items?company_id=${encCompanyId}&page=${page}&per_page=${perPage}`,
      `/rest/v1.0/projects/${encProjectId}/purchase_order_contracts/${encContractId}/line_items?company_id=${encCompanyId}&page=${page}&per_page=${perPage}`,
      `/rest/v2.0/companies/${encodeURIComponent(companyId)}/projects/${encProjectId}/commitment_contracts/${encContractId}/line_items?page=${page}&per_page=${perPage}`,
    ];
  }

  async function fetchPageWithFallback(page: number, preferredEndpoint?: string) {
    const candidates = candidateEndpoints(page);
    if (preferredEndpoint && candidates.includes(preferredEndpoint)) {
      candidates.splice(candidates.indexOf(preferredEndpoint), 1);
      candidates.unshift(preferredEndpoint);
    }

    for (const endpoint of candidates) {
      try {
        const response = await makeRequest(endpoint, accessToken, undefined, companyId, [400, 404, 500]);
        return {
          records: unwrapArray(response) as ProcoreLineItemContractDetail[],
          notEnabled: false,
          usedEndpoint: endpoint,
        };
      } catch (err) {
        if (isNotFoundError(err) || isIgnorableProbeError(err)) continue;
        throw err;
      }
    }

    return { records: [] as ProcoreLineItemContractDetail[], notEnabled: true, usedEndpoint: preferredEndpoint };
  }

  const records: ProcoreLineItemContractDetail[] = [];
  let page = 1;
  let preferredEndpoint: string | undefined;
  let previousSignature = "";

  while (true) {
    const pageResult = await fetchPageWithFallback(page, preferredEndpoint);
    if (pageResult.notEnabled) {
      if (page === 1) return { records: [], notEnabled: true };
      break;
    }
    preferredEndpoint = pageResult.usedEndpoint;

    const pageRecords = pageResult.records;
    const signature = pageSignature(pageRecords as Array<Record<string, unknown>>);
    if (signature && signature === previousSignature) {
      console.warn(
        `[PO Sync] Repeated line-item page detected for contract ${purchaseOrderContractId} in project ${projectId} at page ${page}; stopping pagination.`
      );
      break;
    }
    previousSignature = signature;

    if (!pageRecords.length) break;
    records.push(...pageRecords);
    if (pageRecords.length < perPage) break;
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
      projectsWithPurchaseOrderContracts: 0,
      projectsNotEnabled: 0,
      projectsWithoutPurchaseOrderContracts: 0,
      totalPurchaseOrderContractsFetched: 0,
      totalLineItemContractDetailsFetched: 0,
      totalLineItemContractDetailsSaved: 0,
      totalProjectsCreated: 0,
      activeProjects: [] as Array<{
        projectId: string;
        projectNumber: string | null;
        projectName: string;
        purchaseOrderContractCount: number;
        lineItemContractDetailCount: number;
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
        const { records: contracts, notEnabled } = await fetchPurchaseOrderContractsForProject(
          accessToken,
          companyId,
          projectId,
          perPage
        );

        if (notEnabled) {
          summary.projectsNotEnabled += 1;
          summary.activeProjects.push({
            projectId,
            projectNumber: projectNumber || null,
            projectName,
            purchaseOrderContractCount: 0,
            lineItemContractDetailCount: 0,
            savedCount: 0,
            projectCreated: false,
            status: "Not enabled (404)",
          });
          return;
        }

        if (!contracts.length) {
          summary.projectsWithoutPurchaseOrderContracts += 1;
          summary.activeProjects.push({
            projectId,
            projectNumber: projectNumber || null,
            projectName,
            purchaseOrderContractCount: 0,
            lineItemContractDetailCount: 0,
            savedCount: 0,
            projectCreated: false,
            status: "No purchase order contracts",
          });
          return;
        }

        summary.projectsWithPurchaseOrderContracts += 1;
        summary.totalPurchaseOrderContractsFetched += contracts.length;

        let detailCount = 0;
        let savedCount = 0;
        let detailsNotEnabled = false;
        let projectCreated = false;

        for (const contract of contracts) {
          const contractId = String(asObject(contract).id ?? "").trim();
          if (!contractId) continue;
          const { records: details, notEnabled: contractDetailsNotEnabled } = await fetchLineItemContractDetailsForContract(
            accessToken,
            companyId,
            projectId,
            contractId,
            perPage
          );
          if (contractDetailsNotEnabled) {
            detailsNotEnabled = true;
            continue;
          }

          if (persist) {
            const persisted = await persistPurchaseOrderLineItemDetails(contract, details, {
              companyId,
              projectId,
              projectName,
              projectNumber: projectNumber || undefined,
              createProjectIfMissing: true,
            });
            savedCount += persisted.saved;
            summary.totalLineItemContractDetailsSaved += persisted.saved;
            if (persisted.projectCreated) {
              projectCreated = true;
            }
          } else {
            savedCount += details.length;
          }

          detailCount += details.length;
          summary.totalLineItemContractDetailsFetched += details.length;
        }

        if (projectCreated) {
          summary.totalProjectsCreated += 1;
        }

        summary.activeProjects.push({
          projectId,
          projectNumber: projectNumber || null,
          projectName,
          purchaseOrderContractCount: contracts.length,
          lineItemContractDetailCount: detailCount,
          savedCount,
          projectCreated,
          status: detailsNotEnabled ? "Detail endpoint unavailable (404)" : detailCount > 0 ? "Found details" : "No line item details",
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

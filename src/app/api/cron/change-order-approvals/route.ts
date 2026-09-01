import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  getClientCredentialsToken,
  hasValidProcoreSyncSecret,
  makeRequest,
  procoreConfig,
  withProcoreLiveApiBypassForSyncSecret,
} from "@/lib/procore";
import { upsertChangeOrderPackage } from "@/lib/procoreChangeOrderPackages";
import {
  commitmentMakerChangeOrderContextFromRecord,
  isApprovedChangeOrderStatus,
} from "@/lib/procoreCommitmentMakerTasks";
import { enqueueCommitmentMakerTasks } from "@/lib/procoreCommitmentMakerTaskQueue";
import { upsertPotentialChangeOrder } from "@/lib/procorePotentialChangeOrders";

export const dynamic = "force-dynamic";
export const maxDuration = 780;

type JsonObject = Record<string, unknown>;

type CandidateProject = {
  project_id: string;
};

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function asRows(payload: unknown): JsonObject[] {
  if (Array.isArray(payload)) {
    return payload.map(asObject).filter((item): item is JsonObject => Boolean(item));
  }
  const record = asObject(payload);
  if (!record) return [];
  for (const candidate of [record.data, record.potential_change_orders, record.change_order_packages]) {
    if (Array.isArray(candidate)) {
      return candidate.map(asObject).filter((item): item is JsonObject => Boolean(item));
    }
  }
  return [];
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

async function fetchAll(params: {
  accessToken: string;
  companyId: string;
  pathForPage: (page: number) => string;
}) {
  const rows: JsonObject[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const pageRows = asRows(await makeRequest(
      params.pathForPage(page),
      params.accessToken,
      { method: "GET", cache: "no-store" },
      params.companyId,
      [404],
    ));
    rows.push(...pageRows);
    if (pageRows.length < 100) break;
  }
  return rows;
}

async function persistPotentialChangeOrder(params: {
  companyId: string;
  projectId: string;
  record: JsonObject;
}) {
  const changeOrderId = text(params.record.id);
  if (!changeOrderId) return false;
  const previous = await prisma.procorePotentialChangeOrder.findUnique({
    where: {
      companyId_projectId_changeOrderId: {
        companyId: params.companyId,
        projectId: params.projectId,
        changeOrderId,
      },
    },
    select: { status: true },
  });
  if (isApprovedChangeOrderStatus(params.record.status)
    && !isApprovedChangeOrderStatus(previous?.status)) {
    const changeOrder = commitmentMakerChangeOrderContextFromRecord(params.record);
    if (!changeOrder) return false;
    await enqueueCommitmentMakerTasks({
      companyId: params.companyId,
      projectId: params.projectId,
      changeOrder,
      userEmail: "procore-change-order-approval-poll@pmcdecor.com",
      taskKinds: ["commitment_verification"],
    });
  }
  await upsertPotentialChangeOrder(params);
  return true;
}

async function persistChangeOrderPackage(params: {
  companyId: string;
  projectId: string;
  contractId: string;
  record: JsonObject;
}) {
  const packageId = text(params.record.id);
  if (!packageId) return false;
  const previous = await prisma.procoreChangeOrderPackage.findUnique({
    where: {
      companyId_projectId_packageId: {
        companyId: params.companyId,
        projectId: params.projectId,
        packageId,
      },
    },
    select: { status: true },
  });
  if (isApprovedChangeOrderStatus(params.record.status)
    && !isApprovedChangeOrderStatus(previous?.status)) {
    const changeOrder = commitmentMakerChangeOrderContextFromRecord(params.record);
    if (!changeOrder) return false;
    await enqueueCommitmentMakerTasks({
      companyId: params.companyId,
      projectId: params.projectId,
      changeOrder,
      userEmail: "procore-change-order-approval-poll@pmcdecor.com",
      taskKinds: ["commitment_verification"],
    });
  }
  await upsertChangeOrderPackage(params);
  return true;
}

export async function POST(request: NextRequest) {
  if (!hasValidProcoreSyncSecret(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  return withProcoreLiveApiBypassForSyncSecret(request, async () => {
    const companyId = String(procoreConfig.companyId || "").trim();
    if (!companyId) {
      return NextResponse.json({ success: false, error: "PROCORE_COMPANY_ID is not configured." }, { status: 503 });
    }

    const projects = await prisma.$queryRawUnsafe<CandidateProject[]>(`
      SELECT DISTINCT project_id
      FROM (
        SELECT project_id FROM procore_potential_change_orders WHERE company_id = $1
        UNION
        SELECT project_id FROM procore_change_order_packages WHERE company_id = $1
      ) AS change_order_projects
      ORDER BY project_id
    `, companyId);
    const accessToken = await getClientCredentialsToken();
    let potentialChangeOrdersScanned = 0;
    let packagesScanned = 0;
    const errors: string[] = [];

    for (const { project_id: projectId } of projects) {
      try {
        const potentialChangeOrders = await fetchAll({
          accessToken,
          companyId,
          pathForPage: (page) => `/rest/v1.0/potential_change_orders?project_id=${encodeURIComponent(projectId)}&page=${page}&per_page=100`,
        });
        for (const record of potentialChangeOrders) {
          if (await persistPotentialChangeOrder({ companyId, projectId, record })) {
            potentialChangeOrdersScanned += 1;
          }
        }

        const primeContracts = await fetchAll({
          accessToken,
          companyId,
          pathForPage: (page) => `/rest/v1.0/prime_contracts?project_id=${encodeURIComponent(projectId)}&page=${page}&per_page=100`,
        });
        for (const contract of primeContracts) {
          const contractId = text(contract.id);
          if (!contractId) continue;
          const packages = await fetchAll({
            accessToken,
            companyId,
            pathForPage: (page) => `/rest/v1.0/change_order_packages?project_id=${encodeURIComponent(projectId)}&contract_id=${encodeURIComponent(contractId)}&page=${page}&per_page=100`,
          });
          for (const record of packages) {
            if (await persistChangeOrderPackage({ companyId, projectId, contractId, record })) {
              packagesScanned += 1;
            }
          }
        }
      } catch (error) {
        errors.push(`project:${projectId} ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      projectsScanned: projects.length,
      potentialChangeOrdersScanned,
      packagesScanned,
      errors: errors.slice(0, 25),
    }, { status: errors.length === 0 ? 200 : 500 });
  });
}

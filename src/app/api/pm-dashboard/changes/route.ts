import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getRequestUserEmail } from "@/lib/requestUser";
import {
  buildProcoreChangeUrl,
  isOpenPmChange,
  type PmChangeType,
} from "@/lib/pmDashboardChanges";
import type { UnknownRecord } from "@/lib/pmDashboard";

export const dynamic = "force-dynamic";

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

function payloadRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function latestDate(values: Array<Date | null | undefined>): Date | null {
  return values.reduce<Date | null>((latest, value) => (
    value && (!latest || value > latest) ? value : latest
  ), null);
}

export async function GET(request: NextRequest) {
  const email = await getRequestUserEmail(request);
  if (!email) return jsonNoStore({ success: false, error: "Authentication required." }, { status: 401 });

  try {
    const employee = await prisma.employee.findFirst({
      where: { email: { equals: email, mode: "insensitive" }, isActive: true },
      select: { firstName: true, lastName: true },
    });
    const employeeName = employee ? `${employee.firstName} ${employee.lastName}`.trim() : "";
    const reverseEmployeeName = employee ? `${employee.lastName}, ${employee.firstName}`.trim() : "";
    const companyId = (process.env.PROCORE_COMPANY_ID || "598134325805519").trim();
    const assignedProjectRows = await prisma.pmcActionItem.findMany({
      where: { companyId, assigneeEmails: { has: email.toLowerCase() } },
      distinct: ["procoreProjectId"],
      select: { procoreProjectId: true },
    });
    const assignedProjectIds = assignedProjectRows.map((item) => item.procoreProjectId);
    const projects = await prisma.pmcProject.findMany({
      where: {
        companyId,
        OR: [
          ...(assignedProjectIds.length ? [{ procoreProjectId: { in: assignedProjectIds } }] : []),
          { projectManager: { equals: email, mode: "insensitive" } },
          ...(employeeName ? [{ projectManager: { equals: employeeName, mode: "insensitive" as const } }] : []),
          ...(reverseEmployeeName ? [{ projectManager: { equals: reverseEmployeeName, mode: "insensitive" as const } }] : []),
        ],
      },
      select: { procoreProjectId: true, projectNumber: true, projectName: true, projectManager: true },
      orderBy: { projectName: "asc" },
    });
    const projectIds = projects.map((project) => project.procoreProjectId);
    const projectById = new Map(projects.map((project) => [project.procoreProjectId, {
      id: project.procoreProjectId,
      number: project.projectNumber,
      name: project.projectName,
      manager: project.projectManager,
    }]));

    if (!projectIds.length) {
      return jsonNoStore({
        success: true,
        user: { email, name: employee ? employeeName : email.split("@")[0] },
        latestSync: null,
        items: [],
      });
    }

    const [changeEvents, potentialChangeOrders, primeChangeOrders] = await Promise.all([
      prisma.pmcActionItem.findMany({
        where: { companyId, procoreProjectId: { in: projectIds }, sourceType: "change_event", isOpen: true },
      }),
      prisma.procorePotentialChangeOrder.findMany({
        where: { companyId, projectId: { in: projectIds } },
      }),
      prisma.procoreChangeOrderPackage.findMany({
        where: { companyId, projectId: { in: projectIds } },
      }),
    ]);

    const eventItems = changeEvents
      .filter((item) => isOpenPmChange("change_event", item.status, payloadRecord(item.payload)))
      .map((item) => ({
        id: `change_event:${item.procoreProjectId}:${item.sourceId}`,
        type: "change_event" as PmChangeType,
        sourceId: item.sourceId,
        contractId: null,
        number: item.number,
        title: item.title,
        description: item.description,
        status: item.status,
        amount: null,
        updatedAt: item.syncedAt.toISOString(),
        sourceUrl: buildProcoreChangeUrl({
          type: "change_event",
          projectId: item.procoreProjectId,
          sourceId: item.sourceId,
          existingUrl: item.sourceUrl,
          procoreWebOrigin: process.env.PROCORE_WEB_ORIGIN,
        }),
        project: projectById.get(item.procoreProjectId),
      }));

    const pcoItems = potentialChangeOrders
      .filter((item) => isOpenPmChange("pco", item.status, payloadRecord(item.payload)))
      .map((item) => ({
        id: `pco:${item.projectId}:${item.changeOrderId}`,
        type: "pco" as PmChangeType,
        sourceId: item.changeOrderId,
        contractId: item.contractId,
        number: item.number,
        title: item.title || `Potential Change Order ${item.number || item.changeOrderId}`,
        description: item.description,
        status: item.status,
        amount: item.amount?.toString() || null,
        updatedAt: (item.sourceUpdatedAt || item.syncedAt).toISOString(),
        sourceUrl: buildProcoreChangeUrl({
          type: "pco",
          projectId: item.projectId,
          sourceId: item.changeOrderId,
          contractId: item.contractId,
          procoreWebOrigin: process.env.PROCORE_WEB_ORIGIN,
        }),
        project: projectById.get(item.projectId),
      }));

    const pccoItems = primeChangeOrders
      .filter((item) => isOpenPmChange("pcco", item.status, payloadRecord(item.payload)))
      .map((item) => ({
        id: `pcco:${item.projectId}:${item.packageId}`,
        type: "pcco" as PmChangeType,
        sourceId: item.packageId,
        contractId: item.contractId,
        number: item.number,
        title: item.title || `Prime Contract Change Order ${item.number || item.packageId}`,
        description: item.description,
        status: item.status,
        amount: item.amount?.toString() || null,
        updatedAt: (item.sourceUpdatedAt || item.syncedAt).toISOString(),
        sourceUrl: buildProcoreChangeUrl({
          type: "pcco",
          projectId: item.projectId,
          sourceId: item.packageId,
          contractId: item.contractId,
          procoreWebOrigin: process.env.PROCORE_WEB_ORIGIN,
        }),
        project: projectById.get(item.projectId),
      }));

    const items = [...eventItems, ...pcoItems, ...pccoItems]
      .filter((item) => Boolean(item.project))
      .sort((a, b) => (
        a.project!.name.localeCompare(b.project!.name)
        || a.type.localeCompare(b.type)
        || String(a.number || a.title).localeCompare(String(b.number || b.title), undefined, { numeric: true })
      ));
    const latestSync = latestDate([
      ...changeEvents.map((item) => item.syncedAt),
      ...potentialChangeOrders.map((item) => item.syncedAt),
      ...primeChangeOrders.map((item) => item.syncedAt),
    ]);

    return jsonNoStore({
      success: true,
      user: { email, name: employee ? employeeName : email.split("@")[0] },
      latestSync: latestSync?.toISOString() || null,
      items,
    });
  } catch (error) {
    console.error("Failed to load PM changes dashboard:", error);
    return jsonNoStore(
      { success: false, error: "The open changes view is temporarily unavailable." },
      { status: 503 },
    );
  }
}

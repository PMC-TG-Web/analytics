import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getRequiredSyncSecret, parsePositiveInt } from "@/lib/cronSync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type StepResult = {
  step: string;
  status: "ok" | "error";
  httpStatus: number;
  detail?: unknown;
};

type ProjectIdRow = {
  project_id: string;
};

const SINGLE_ALLOWED_PROCORE_COMPANY_ID = (process.env.PROCORE_COMPANY_ID || "598134325805519").trim();

function getSecretFromRequest(request: NextRequest): string {
  const fromSyncHeader = request.headers.get("x-sync-secret")?.trim();
  if (fromSyncHeader) return fromSyncHeader;

  const fromCronHeader = request.headers.get("x-cron-secret")?.trim();
  if (fromCronHeader) return fromCronHeader;

  const auth = request.headers.get("authorization")?.trim();
  if (!auth) return "";

  const bearerMatch = auth.match(/^Bearer\s+(.+)$/i);
  return bearerMatch?.[1]?.trim() || auth;
}

function hasValidSecret(request: NextRequest): boolean {
  const provided = getSecretFromRequest(request);
  if (!provided) return false;

  const syncSecret = getRequiredSyncSecret();
  const cronSecret = (process.env.CRON_SECRET || "").trim();
  return provided === syncSecret || (!!cronSecret && provided === cronSecret);
}

function parseCsvIds(value: unknown): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseProjectIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  return parseCsvIds(value);
}

function toDateKey(date: Date): string {
  return date.toISOString().split("T")[0];
}

function normalizeDate(value: unknown): string | null {
  const text = String(value || "").trim();
  if (!text) return null;

  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return text;
}

function buildDateWindow(body: Record<string, unknown>) {
  const explicitStart = normalizeDate(body.startDate || body.start_date);
  const explicitEnd = normalizeDate(body.endDate || body.end_date);
  if (explicitStart && explicitEnd) {
    return { startDate: explicitStart, endDate: explicitEnd };
  }

  const lookbackDays = Math.min(
    120,
    Math.max(
      1,
      Number.parseInt(String(body.lookbackDays || process.env.PROCORE_ACTUALS_SYNC_LOOKBACK_DAYS || "45"), 10) || 45
    )
  );
  const now = Date.now();
  return {
    startDate: explicitStart || toDateKey(new Date(now - lookbackDays * 24 * 60 * 60 * 1000)),
    endDate: explicitEnd || toDateKey(new Date(now)),
  };
}

function selectRotatingProjectBatch(params: {
  projectIds: string[];
  batchSize: number;
  offsetInput: unknown;
  slotMinutes: number;
}) {
  const { projectIds, batchSize, offsetInput, slotMinutes } = params;
  if (!projectIds.length) return { selectedProjectIds: [] as string[], offset: 0 };

  const parsedOffset = Number.parseInt(String(offsetInput ?? ""), 10);
  const computedOffset =
    Math.floor(Date.now() / (slotMinutes * 60 * 1000)) * batchSize;
  const offset = (Number.isFinite(parsedOffset) && parsedOffset >= 0 ? parsedOffset : computedOffset) % projectIds.length;

  const selectedProjectIds = projectIds.slice(offset, offset + batchSize);
  if (selectedProjectIds.length < batchSize) {
    selectedProjectIds.push(...projectIds.slice(0, batchSize - selectedProjectIds.length));
  }

  return { selectedProjectIds, offset };
}

async function readResponseDetail(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }

  return response.text().catch(() => null);
}

function summarizeSyncDetail(detail: unknown) {
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return detail;
  const value = detail as Record<string, unknown>;
  return {
    success: value.success,
    companyId: value.companyId,
    totalProjectsChecked: value.totalProjectsChecked,
    projectsWithActivity: value.projectsWithActivity,
    totalEntriesFetched: value.totalEntriesFetched,
    totalEntriesSaved: value.totalEntriesSaved,
    totalLogsFetched: value.totalLogsFetched,
    totalLogsSaved: value.totalLogsSaved,
    projectsWithPurchaseOrderContracts: value.projectsWithPurchaseOrderContracts,
    totalPurchaseOrderContractsFetched: value.totalPurchaseOrderContractsFetched,
    totalLineItemContractDetailsFetched: value.totalLineItemContractDetailsFetched,
    totalLineItemContractDetailsSaved: value.totalLineItemContractDetailsSaved,
    activeProjects: Array.isArray(value.activeProjects) ? value.activeProjects.slice(0, 10) : undefined,
    errors: Array.isArray(value.errors) ? value.errors.slice(0, 10) : undefined,
    error: value.error,
    details: value.details,
  };
}

async function runActualsStep(params: {
  origin: string;
  syncSecret: string;
  path: string;
  step: string;
  body: Record<string, unknown>;
}): Promise<StepResult> {
  try {
    const response = await fetch(`${params.origin}${params.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sync-secret": params.syncSecret,
      },
      body: JSON.stringify(params.body),
    });
    const detail = await readResponseDetail(response);

    return {
      step: params.step,
      status: response.ok ? "ok" : "error",
      httpStatus: response.status,
      detail: summarizeSyncDetail(detail),
    };
  } catch (error) {
    return {
      step: params.step,
      status: "error",
      httpStatus: 0,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function POST(request: NextRequest) {
  if (!hasValidSecret(request)) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const syncSecret = getRequiredSyncSecret();
  if (!syncSecret) {
    return NextResponse.json(
      { success: false, error: "PROCORE_SYNC_SECRET is not configured" },
      { status: 503 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const requestedCompanyId = String(
    body.companyId || request.nextUrl.searchParams.get("companyId") || ""
  ).trim();

  if (requestedCompanyId && requestedCompanyId !== SINGLE_ALLOWED_PROCORE_COMPANY_ID) {
    return NextResponse.json(
      { success: false, error: "Forbidden company context for this deployment." },
      { status: 403 }
    );
  }

  const companyId = requestedCompanyId || SINGLE_ALLOWED_PROCORE_COMPANY_ID;
  if (!companyId) {
    return NextResponse.json({ success: false, error: "Missing companyId" }, { status: 400 });
  }

  const explicitProjectIds = parseProjectIds(body.projectIds || request.nextUrl.searchParams.get("projectIds"));
  const batchSize = Math.min(
    10,
    Math.max(
      1,
      Number.parseInt(String(body.batchSize || process.env.PROCORE_ACTUALS_SYNC_PROJECT_BATCH_SIZE || "1"), 10) || 1
    )
  );
  const slotMinutes = Math.max(
    1,
    parsePositiveInt(String(process.env.PROCORE_ACTUALS_SYNC_SLOT_MINUTES || "15"), 15)
  );
  const perPage = Math.min(
    200,
    Math.max(1, Number.parseInt(String(body.perPage || process.env.PROCORE_ACTUALS_SYNC_PER_PAGE || "100"), 10) || 100)
  );
  const { startDate, endDate } = buildDateWindow(body);

  const projectIds = explicitProjectIds.length
    ? explicitProjectIds
    : (await prisma.$queryRawUnsafe<ProjectIdRow[]>(
        `
          SELECT DISTINCT project_id
          FROM budgetlineitems
          WHERE company_id = $1
            AND project_id IS NOT NULL
            AND project_id <> ''
          ORDER BY project_id ASC
        `,
        companyId
      )).map((row) => row.project_id);

  const { selectedProjectIds, offset } = explicitProjectIds.length
    ? { selectedProjectIds: explicitProjectIds, offset: 0 }
    : selectRotatingProjectBatch({
        projectIds,
        batchSize,
        offsetInput: body.offset ?? request.nextUrl.searchParams.get("offset"),
        slotMinutes,
      });

  const origin = request.nextUrl.origin.replace(/\/$/, "");
  const triggeredBy = explicitProjectIds.length ? "actuals-manual" : "actuals-cron";
  const startedAt = Date.now();
  let logId: bigint | null = null;

  try {
    const log = await prisma.syncLog.create({
      data: {
        companyId,
        triggeredBy,
        steps: [
          {
            step: "select-projects",
            status: "ok",
            projectCount: projectIds.length,
            selectedProjectIds,
            offset,
          },
          { step: "purchase-order-line-item-details", status: "pending" },
          { step: "timecard-entries", status: "pending" },
          { step: "productivity-logs", status: "pending" },
        ],
      },
      select: { id: true },
    });
    logId = log.id;
  } catch (error) {
    console.error("[cron/actuals] Failed to create log entry:", error);
  }

  const commonSyncBody = {
    companyId,
    projectIds: selectedProjectIds,
    startDate,
    endDate,
    perPage,
    concurrency: 1,
    forceUserOAuth: false,
    persist: true,
  };

  const steps: StepResult[] = [
    {
      step: "select-projects",
      status: "ok",
      httpStatus: 200,
      detail: {
        projectCount: projectIds.length,
        selectedProjectIds,
        offset,
        batchSize: explicitProjectIds.length ? selectedProjectIds.length : batchSize,
      },
    },
  ];

  if (selectedProjectIds.length) {
    steps.push(
      await runActualsStep({
        origin,
        syncSecret,
        path: "/api/procore/sync/purchase-order-line-item-details",
        step: "purchase-order-line-item-details",
        body: commonSyncBody,
      })
    );
    steps.push(
      await runActualsStep({
        origin,
        syncSecret,
        path: "/api/procore/sync/timecard-entries",
        step: "timecard-entries",
        body: commonSyncBody,
      })
    );
    steps.push(
      await runActualsStep({
        origin,
        syncSecret,
        path: "/api/procore/sync/productivity-projects",
        step: "productivity-logs",
        body: commonSyncBody,
      })
    );
  }

  const totalMs = Date.now() - startedAt;
  const success = steps.every((step) => step.status === "ok");

  if (logId !== null) {
    await prisma.syncLog.update({
      where: { id: logId },
      data: {
        finishedAt: new Date(),
        success,
        totalMs,
        steps: steps as object[],
      },
    }).catch((error) => {
      console.error("[cron/actuals] Failed to update log entry:", error);
    });
  }

  return NextResponse.json(
    {
      success,
      companyId,
      logId: logId?.toString() ?? null,
      projectCount: projectIds.length,
      selectedProjectIds,
      offset,
      syncWindow: { startDate, endDate },
      totalMs,
      steps,
    },
    { status: success ? 200 : 207 }
  );
}

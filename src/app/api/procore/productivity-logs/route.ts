// API endpoint to fetch Procore productivity logs and optionally persist them to Prisma
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { makeRequest } from "@/lib/procore";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

type InputParams = {
  projectId: string;
  logDate?: string;
  startDate?: string;
  endDate?: string;
  createdByIds?: string[];
  dailyLogSegmentId?: string;
  page: number;
  perPage: number;
  persist: boolean;
  accessToken?: string;
};

type ProcoreLog = Record<string, unknown>;

function parsePositiveInt(value: string | undefined, fallback: number, max?: number): number {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (Number.isNaN(parsed) || parsed < 1) return fallback;
  if (max && parsed > max) return max;
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
}

function parseCsv(value: string | undefined): string[] {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeDate(value: unknown): string | undefined {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const asDate = new Date(raw);
  if (Number.isNaN(asDate.getTime())) return undefined;
  return asDate.toISOString().split("T")[0];
}

function buildEndpoint(params: InputParams): string {
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

  query.set("page", String(params.page));
  query.set("per_page", String(params.perPage));

  return `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/productivity_logs?${query.toString()}`;
}

async function persistLogs(logs: ProcoreLog[], projectId: string) {
  if (!logs.length) {
    return {
      attempted: 0,
      saved: 0,
      skipped: 0,
      projectLinked: false,
    };
  }

  const dbProject = await prisma.project.findFirst({
    where: {
      OR: [
        { projectNumber: projectId },
        {
          customFields: {
            path: ["procoreProjectId"],
            equals: projectId,
          },
        },
      ],
    },
    select: {
      id: true,
      projectNumber: true,
    },
  });

  let saved = 0;
  let skipped = 0;

  for (const log of logs) {
    const procoreId = String(log.id ?? "").trim();
    if (!procoreId) {
      skipped += 1;
      continue;
    }

    const dateText = normalizeDate(log.log_date ?? log.date);
    if (!dateText) {
      skipped += 1;
      continue;
    }

    const createdBy =
      log.created_by && typeof log.created_by === "object"
        ? (log.created_by as Record<string, unknown>)
        : null;

    const parsedHours = Number.parseFloat(String(log.hours ?? "0"));
    const customFieldsPayload: Prisma.InputJsonObject = {
      procoreId,
      procoreProjectId: projectId,
      dailyLogSegmentId: String(log.daily_log_segment_id ?? "") || null,
      createdById: String(createdBy?.id ?? "") || null,
      createdByName: String(createdBy?.name ?? "") || null,
      originalData: log as unknown as Prisma.InputJsonValue,
    };

    await prisma.productivityLog.upsert({
      where: { id: procoreId },
      update: {
        projectId: dbProject?.id,
        jobKey: dbProject?.projectNumber || projectId,
        date: new Date(`${dateText}T00:00:00.000Z`),
        foreman: String(log.foreman_name ?? log.foreman ?? "") || null,
        crew: String(log.crew_name ?? log.crew ?? "") || null,
        hours: Number.isFinite(parsedHours) ? parsedHours : null,
        scopeOfWork: String(log.scope_of_work ?? log.line_item_description ?? "") || null,
        notes: String(log.notes ?? "") || null,
        customFields: customFieldsPayload,
      },
      create: {
        id: procoreId,
        projectId: dbProject?.id,
        jobKey: dbProject?.projectNumber || projectId,
        date: new Date(`${dateText}T00:00:00.000Z`),
        foreman: String(log.foreman_name ?? log.foreman ?? "") || null,
        crew: String(log.crew_name ?? log.crew ?? "") || null,
        hours: Number.isFinite(parsedHours) ? parsedHours : null,
        scopeOfWork: String(log.scope_of_work ?? log.line_item_description ?? "") || null,
        notes: String(log.notes ?? "") || null,
        customFields: customFieldsPayload,
      },
    });

    saved += 1;
  }

  return {
    attempted: logs.length,
    saved,
    skipped,
    projectLinked: Boolean(dbProject?.id),
  };
}

async function handleProductivityLogsRequest(params: InputParams) {
  const endpoint = buildEndpoint(params);
  const logs = await makeRequest(endpoint, params.accessToken || "");
  const normalizedLogs = Array.isArray(logs) ? (logs as ProcoreLog[]) : [];
  const persistence = params.persist
    ? await persistLogs(normalizedLogs, params.projectId)
    : { attempted: 0, saved: 0, skipped: 0, projectLinked: false };

  return {
    success: true,
    projectId: params.projectId,
    logDate: params.logDate,
    startDate: params.startDate,
    endDate: params.endDate,
    createdByIds: params.createdByIds || [],
    dailyLogSegmentId: params.dailyLogSegmentId || null,
    page: params.page,
    perPage: params.perPage,
    count: normalizedLogs.length,
    persisted: params.persist,
    persistence,
    logs: normalizedLogs,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const cookieStore = await cookies();
    const cookieToken = cookieStore.get("procore_access_token")?.value;
    const bodyToken = searchParams.get("accessToken") || undefined;
    const accessToken = cookieToken || bodyToken;

    if (!accessToken) {
      return NextResponse.json(
        {
          error: "Missing access token. Please authenticate via OAuth first or provide accessToken.",
          connectUrl: "/api/auth/procore/login",
        },
        { status: 401 }
      );
    }

    const projectId = String(searchParams.get("projectId") || "598134326278124").trim();
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const createdByFromRepeat = searchParams.getAll("filters[created_by_id]").filter(Boolean);
    const createdByFromCsv = parseCsv(searchParams.get("created_by_ids") || undefined);
    const createdByIds = [...createdByFromRepeat, ...createdByFromCsv];

    const params: InputParams = {
      projectId,
      logDate: normalizeDate(searchParams.get("log_date")),
      startDate: normalizeDate(searchParams.get("start_date")) || "2025-08-01",
      endDate: normalizeDate(searchParams.get("end_date")) || new Date().toISOString().split("T")[0],
      createdByIds,
      dailyLogSegmentId: String(searchParams.get("filters[daily_log_segment_id]") || "").trim() || undefined,
      page: parsePositiveInt(searchParams.get("page") || undefined, 1),
      perPage: parsePositiveInt(searchParams.get("per_page") || undefined, 100, 200),
      persist: parseBoolean(searchParams.get("persist") || undefined, true),
      accessToken,
    };

    const result = await handleProductivityLogsRequest(params);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Procore productivity logs API error:", message);

    return NextResponse.json(
      {
        error: "Failed to fetch Procore productivity logs",
        details: message,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const cookieStore = await cookies();
    const cookieToken = cookieStore.get("procore_access_token")?.value;
    const accessToken = cookieToken || String(body.accessToken || "").trim() || undefined;

    if (!accessToken) {
      return NextResponse.json(
        {
          error: "Missing access token. Please authenticate via OAuth first or provide accessToken in request body.",
          connectUrl: "/api/auth/procore/login",
        },
        { status: 401 }
      );
    }

    const createdByIdsFromBody = Array.isArray(body.createdByIds)
      ? body.createdByIds.map((value) => String(value)).filter(Boolean)
      : parseCsv(String(body.createdByIds || ""));

    const params: InputParams = {
      projectId: String(body.projectId || "598134326278124").trim(),
      logDate: normalizeDate(body.logDate || body.log_date),
      startDate: normalizeDate(body.startDate || body.start_date) || "2025-08-01",
      endDate: normalizeDate(body.endDate || body.end_date) || new Date().toISOString().split("T")[0],
      createdByIds: createdByIdsFromBody,
      dailyLogSegmentId:
        String(body.dailyLogSegmentId || body["filters[daily_log_segment_id]"] || "").trim() || undefined,
      page: parsePositiveInt(String(body.page || "1"), 1),
      perPage: parsePositiveInt(String(body.perPage || body.per_page || "100"), 100, 200),
      persist: body.persist === undefined ? true : Boolean(body.persist),
      accessToken,
    };

    if (!params.projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const result = await handleProductivityLogsRequest(params);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Procore productivity logs API error:", message);

    return NextResponse.json(
      {
        error: "Failed to fetch Procore productivity logs",
        details: message,
      },
      { status: 500 }
    );
  }
}

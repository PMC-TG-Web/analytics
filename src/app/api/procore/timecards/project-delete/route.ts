import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStr(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function readNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function unwrapArray(value: unknown): UnknownRecord[] {
  if (Array.isArray(value)) return value.filter((item): item is UnknownRecord => isRecord(item));
  if (isRecord(value)) {
    if (Array.isArray(value.data)) return value.data.filter((item): item is UnknownRecord => isRecord(item));
    if (Array.isArray(value.results)) return value.results.filter((item): item is UnknownRecord => isRecord(item));
  }
  return [];
}

function normalizeDate(value: unknown): string {
  const text = readStr(value);
  if (!text) return "";
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

async function resolveAccessToken() {
  const cookieStore = await cookies();
  const cookieToken =
    cookieStore.get("procore_access_token")?.value ||
    cookieStore.get("procoreAccessToken")?.value ||
    cookieStore.get("access_token")?.value;
  if (cookieToken) return { accessToken: cookieToken, tokenSource: "cookie" };

  const clientCredentialsToken = await getClientCredentialsToken();
  return { accessToken: clientCredentialsToken, tokenSource: "client_credentials" };
}

async function procoreFetch(params: {
  accessToken: string;
  companyId: string;
  path: string;
  method?: string;
  body?: unknown;
}) {
  const response = await fetch(`${procoreConfig.apiUrl}${params.path}`, {
    method: params.method || "GET",
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      "Procore-Company-Id": params.companyId,
      Accept: "application/json",
      ...(params.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: params.body === undefined ? undefined : JSON.stringify(params.body),
    cache: "no-store",
  });

  const text = await response.text();
  let payload: unknown = text;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const details = typeof payload === "string" ? payload : JSON.stringify(payload);
    const error = new Error(`Procore ${params.method || "GET"} ${params.path} failed (${response.status}): ${details}`);
    (error as Error & { status?: number; payload?: unknown }).status = response.status;
    (error as Error & { status?: number; payload?: unknown }).payload = payload;
    throw error;
  }

  return payload;
}

async function fetchPagedTimecards(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  startDate: string;
  endDate: string;
  maxPages: number;
}) {
  const out: UnknownRecord[] = [];
  let rawRows = 0;
  for (let page = 1; page <= params.maxPages; page += 1) {
    const query = new URLSearchParams({
      company_id: params.companyId,
      page: String(page),
      per_page: "100",
    });
    const payload = await procoreFetch({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/timecard_entries?${query.toString()}`,
    });
    const rawPageRows = unwrapArray(payload);
    rawRows += rawPageRows.length;
    const rows = unwrapArray(payload).filter((row) => {
      const rowDate = normalizeDate(row.date);
      return rowDate && rowDate >= params.startDate && rowDate <= params.endDate;
    });
    out.push(...rows);

    if (rawPageRows.length < 100) break;
  }
  return { rows: out, rawRows };
}

function timecardRowsFromTimesheet(timesheet: UnknownRecord): UnknownRecord[] {
  const nested = unwrapArray(timesheet.timecard_entries || timesheet.timecardEntries);
  const timesheetId = timesheet.id;
  const timesheetDate = timesheet.date;
  return nested.map((entry) => ({
    ...entry,
    _timesheet_id: timesheetId,
    _timesheet_date: timesheetDate,
  }));
}

async function fetchPagedTimesheetTimecards(params: {
  accessToken: string;
  companyId: string;
  projectId: string;
  startDate: string;
  endDate: string;
  maxPages: number;
}) {
  const out: UnknownRecord[] = [];
  let rawTimesheets = 0;
  let rawNestedTimecards = 0;
  for (let page = 1; page <= params.maxPages; page += 1) {
    const query = new URLSearchParams({
      company_id: params.companyId,
      page: String(page),
      per_page: "100",
    });
    const payload = await procoreFetch({
      accessToken: params.accessToken,
      companyId: params.companyId,
      path: `/rest/v1.0/projects/${encodeURIComponent(params.projectId)}/timesheets?${query.toString()}`,
    });
    const timesheets = unwrapArray(payload);
    rawTimesheets += timesheets.length;

    for (const timesheet of timesheets) {
      const entries = timecardRowsFromTimesheet(timesheet);
      rawNestedTimecards += entries.length;
      for (const entry of entries) {
        const rowDate = normalizeDate(entry.date || entry._timesheet_date);
        if (rowDate && rowDate >= params.startDate && rowDate <= params.endDate) out.push(entry);
      }
    }

    if (timesheets.length < 100) break;
  }

  return { rows: out, rawTimesheets, rawNestedTimecards };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const companyId = readStr(body.companyId);
    const projectId = readStr(body.projectId);
    const startDate = normalizeDate(body.startDate);
    const endDate = normalizeDate(body.endDate) || startDate;
    const dryRun = body.dryRun !== false;
    const maxPages = Math.max(1, Math.min(100, Math.trunc(readNum(body.maxPages) || 25)));
    const batchSize = Math.max(1, Math.min(100, Math.trunc(readNum(body.batchSize) || 100)));

    if (!companyId || !projectId || !startDate || !endDate) {
      return NextResponse.json(
        { success: false, error: "companyId, projectId, startDate, and endDate are required." },
        { status: 400 }
      );
    }

    if (endDate < startDate) {
      return NextResponse.json(
        { success: false, error: "endDate must be on or after startDate." },
        { status: 400 }
      );
    }

    const { accessToken, tokenSource } = await resolveAccessToken();
    const directTimecards = await fetchPagedTimecards({ accessToken, companyId, projectId, startDate, endDate, maxPages });
    const timesheetTimecards = await fetchPagedTimesheetTimecards({ accessToken, companyId, projectId, startDate, endDate, maxPages });
    const byId = new Map<string, UnknownRecord>();
    for (const row of [...directTimecards.rows, ...timesheetTimecards.rows]) {
      const id = readStr(row.id);
      if (id && !byId.has(id)) byId.set(id, row);
    }
    const timecards = Array.from(byId.values());
    const ids = Array.from(
      new Set(
        timecards
          .map((row) => readNum(row.id))
          .filter((id): id is number => id !== undefined)
      )
    );

    const deleteResults: UnknownRecord[] = [];
    if (!dryRun && ids.length > 0) {
      for (const idsBatch of chunk(ids, batchSize)) {
        try {
          const result = await procoreFetch({
            accessToken,
            companyId,
            path: `/rest/v1.0/projects/${encodeURIComponent(projectId)}/timesheets`,
            method: "DELETE",
            body: { ids: idsBatch },
          });
          deleteResults.push({ ok: true, ids: idsBatch, result });
        } catch (error) {
          deleteResults.push({
            ok: false,
            ids: idsBatch,
            error: error instanceof Error ? error.message : String(error),
            details: isRecord(error) ? error.payload : undefined,
          });
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    return NextResponse.json({
      success: dryRun ? true : deleteResults.every((row) => row.ok === true),
      dryRun,
      tokenSource,
      target: { companyId, projectId, startDate, endDate },
      counts: {
        found: timecards.length,
        ids: ids.length,
        directTimecardRows: directTimecards.rows.length,
        rawDirectTimecardRows: directTimecards.rawRows,
        timesheetTimecardRows: timesheetTimecards.rows.length,
        rawTimesheets: timesheetTimecards.rawTimesheets,
        rawNestedTimesheetTimecards: timesheetTimecards.rawNestedTimecards,
        deletedBatches: deleteResults.filter((row) => row.ok === true).length,
        failedBatches: deleteResults.filter((row) => row.ok === false).length,
      },
      ids,
      preview: timecards.slice(0, 25).map((row) => ({
        id: row.id,
        date: row.date,
        hours: row.hours,
        source: row._timesheet_id ? "timesheets" : "timecard_entries",
        timesheet_id: row._timesheet_id,
        party: row.party,
        timecard_time_type: row.timecard_time_type,
        cost_code: row.cost_code,
      })),
      deleteResults,
      nextStep: dryRun
        ? "Review ids/preview. Rerun with dryRun=false to delete these project timecard entries through the project timesheets endpoint."
        : "Delete run completed. Review failedBatches/deleteResults.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Project timecard delete failed.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

type UnknownRecord = Record<string, unknown>;

function readStr(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

function readBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  const text = readStr(value).toLowerCase();
  if (text === "true" || text === "1" || text === "yes") return true;
  if (text === "false" || text === "0" || text === "no") return false;
  return fallback;
}

function readInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(readStr(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function getToken() {
  const cookieStore = await cookies();
  const cookieToken = readStr(cookieStore.get("procore_access_token")?.value);
  if (cookieToken) return cookieToken;
  return getClientCredentialsToken();
}

function getCompanyId(input: unknown) {
  return readStr(input) || readStr(procoreConfig.companyId);
}

function rowsFromPayload(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  const wrapped = (data as UnknownRecord)?.data;
  return Array.isArray(wrapped) ? wrapped : [];
}

function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as UnknownRecord)[key];
}

function nestedField(value: unknown, firstKey: string, secondKey: string): unknown {
  const nested = field(value, firstKey);
  return field(nested, secondKey);
}

function pickPossiblePdfFields(row: unknown): Record<string, unknown> {
  const candidates: Record<string, unknown> = {};
  const directKeys = [
    "pdf_url",
    "pdfUrl",
    "download_url",
    "downloadUrl",
    "file_url",
    "fileUrl",
    "url",
    "original_url",
    "originalUrl",
    "thumbnail_url",
    "thumbnailUrl",
  ];

  for (const key of directKeys) {
    const value = field(row, key);
    if (value) candidates[key] = value;
  }

  const nestedCandidates: Array<[string, string]> = [
    ["current_revision", "pdf_url"],
    ["current_revision", "download_url"],
    ["current_revision", "file_url"],
    ["current_revision", "url"],
    ["revision", "pdf_url"],
    ["revision", "download_url"],
    ["revision", "file_url"],
    ["revision", "url"],
  ];

  for (const [firstKey, secondKey] of nestedCandidates) {
    const value = nestedField(row, firstKey, secondKey);
    if (value) candidates[`${firstKey}.${secondKey}`] = value;
  }

  return candidates;
}

function summarizeDrawing(
  row: unknown,
  area: UnknownRecord | null,
  drawingSetNameById: Map<string, string>
): Record<string, unknown> {
  const drawingSetIdRaw = field(row, "drawing_set_id") ?? nestedField(row, "drawing_set", "id");
  const drawingSetId = readStr(drawingSetIdRaw);
  const drawingSetName =
    readStr(nestedField(row, "drawing_set", "name")) ||
    readStr(field(row, "drawing_set_name")) ||
    (drawingSetId ? drawingSetNameById.get(drawingSetId) || "" : "");

  return {
    id: field(row, "id"),
    number: field(row, "number") ?? field(row, "drawing_number"),
    title: field(row, "title") ?? field(row, "drawing_title"),
    drawingAreaId: area?.id ?? field(row, "drawing_area_id") ?? nestedField(row, "drawing_area", "id"),
    drawingAreaName: area?.name ?? nestedField(row, "drawing_area", "name"),
    drawingSetId: drawingSetIdRaw,
    drawingSetName: drawingSetName || null,
    currentRevisionId: nestedField(row, "current_revision", "id"),
    revision: field(row, "revision") ?? nestedField(row, "current_revision", "number"),
    drawingDate: field(row, "date") ?? field(row, "drawing_date") ?? nestedField(row, "current_revision", "date"),
    pdfFields: pickPossiblePdfFields(row),
  };
}

async function fetchJson(url: string, accessToken: string, companyId: string) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Procore-Company-Id": companyId,
    },
    cache: "no-store",
  });

  const text = await response.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : [];
  } catch {
    // Keep raw text for diagnostics.
  }

  if (!response.ok) {
    const summary = (() => {
      if (typeof data === "string") return data;
      if (data && typeof data === "object") {
        const message = (data as UnknownRecord).message;
        const errors = (data as UnknownRecord).errors;
        if (typeof message === "string" && message.trim()) return message;
        if (typeof errors === "string" && errors.trim()) return errors;
      }
      return "";
    })();
    const error = new Error(`Procore request failed (${response.status})`) as Error & {
      status?: number;
      details?: unknown;
    };
    error.message = summary
      ? `Procore request failed (${response.status}) at ${url}: ${summary}`
      : `Procore request failed (${response.status}) at ${url}`;
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return {
    data,
    rows: rowsFromPayload(data),
    total: response.headers.get("total"),
    perPage: response.headers.get("per-page"),
    link: response.headers.get("link"),
  };
}

async function fetchPagedRows({
  path,
  accessToken,
  companyId,
  perPage,
  maxPages,
  baseParams,
}: {
  path: string;
  accessToken: string;
  companyId: string;
  perPage: number;
  maxPages: number;
  baseParams?: URLSearchParams;
}) {
  const apiBase = (procoreConfig.apiUrl || "https://api.procore.com").replace(/\/$/, "");
  const rows: unknown[] = [];
  const rawPages: unknown[] = [];

  for (let page = 1; page <= maxPages; page += 1) {
    const params = new URLSearchParams(baseParams);
    params.set("page", String(page));
    params.set("per_page", String(perPage));

    const result = await fetchJson(`${apiBase}${path}?${params.toString()}`, accessToken, companyId);
    rows.push(...result.rows);
    rawPages.push({ page, count: result.rows.length, total: result.total, data: result.data });

    if (result.rows.length < perPage) break;
  }

  return { rows, rawPages };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const companyId = getCompanyId(url.searchParams.get("companyId"));
    const projectId = readStr(url.searchParams.get("projectId"));
    const perPage = readInt(url.searchParams.get("perPage"), 100, 1, 100);
    const maxPages = readInt(url.searchParams.get("maxPages"), 10, 1, 100);
    const includeDrawings = readBool(url.searchParams.get("includeDrawings"), true);
    const includeUploads = readBool(url.searchParams.get("includeUploads"), true);
    const view = readStr(url.searchParams.get("view"));

    if (!companyId) {
      return NextResponse.json({ error: "Missing required query param: companyId" }, { status: 400 });
    }
    if (!projectId) {
      return NextResponse.json({ error: "Missing required query param: projectId" }, { status: 400 });
    }

    const accessToken = await getToken();
    const encodedProjectId = encodeURIComponent(projectId);

    const warnings: Array<{ type: string; message: string }> = [];

    let areasResult: { rows: unknown[]; rawPages: unknown[] } = { rows: [], rawPages: [] };
    const drawingAreaPaths = [
      `/rest/v1.0/projects/${encodedProjectId}/drawing_areas`,
      `/rest/v1.1/projects/${encodedProjectId}/drawing_areas`,
    ];
    let drawingAreasLoaded = false;
    let drawingAreasLastError = "";
    for (const path of drawingAreaPaths) {
      try {
        areasResult = await fetchPagedRows({
          path,
          accessToken,
          companyId,
          perPage,
          maxPages,
        });
        drawingAreasLoaded = true;
        break;
      } catch (error) {
        drawingAreasLastError = error instanceof Error ? error.message : String(error);
      }
    }
    if (!drawingAreasLoaded) {
      warnings.push({
        type: "drawing_areas_lookup_failed",
        message: drawingAreasLastError || "Unable to load drawing areas from Procore.",
      });
    }

    let setsResult: { rows: unknown[]; rawPages: unknown[] } = { rows: [], rawPages: [] };
    try {
      setsResult = await fetchPagedRows({
        path: `/rest/v1.0/projects/${encodedProjectId}/drawing_sets`,
        accessToken,
        companyId,
        perPage,
        maxPages,
      });
    } catch (error) {
      warnings.push({
        type: "drawing_sets_lookup_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    let uploadsResult: { rows: unknown[]; rawPages: unknown[] } = { rows: [], rawPages: [] };
    if (includeUploads) {
      try {
        uploadsResult = await fetchPagedRows({
          path: `/rest/v1.1/projects/${encodedProjectId}/drawing_uploads`,
          accessToken,
          companyId,
          perPage,
          maxPages,
          baseParams: view ? new URLSearchParams({ view }) : undefined,
        });
      } catch (error) {
        warnings.push({
          type: "drawing_uploads_lookup_failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const drawingsByArea: Array<Record<string, unknown>> = [];
    const drawings: unknown[] = [];
    const drawingSetNameById = new Map<string, string>();
    for (const setRow of setsResult.rows) {
      const setId = readStr(field(setRow, "id"));
      const setName = readStr(field(setRow, "name"));
      if (setId && setName) drawingSetNameById.set(setId, setName);
    }

    if (includeDrawings) {
      for (const area of areasResult.rows) {
        const areaRecord = area && typeof area === "object" ? (area as UnknownRecord) : null;
        const areaId = readStr(areaRecord?.id);
        if (!areaId) continue;

        const params = new URLSearchParams({ project_id: projectId });
        if (view) params.set("view", view);

        let areaDrawings: { rows: unknown[]; rawPages: unknown[] } = { rows: [], rawPages: [] };
        try {
          areaDrawings = await fetchPagedRows({
            path: `/rest/v1.1/drawing_areas/${encodeURIComponent(areaId)}/drawings`,
            accessToken,
            companyId,
            perPage,
            maxPages,
            baseParams: params,
          });
        } catch (error) {
          warnings.push({
            type: "drawing_area_drawings_lookup_failed",
            message: `Area ${areaId}: ${error instanceof Error ? error.message : String(error)}`,
          });
          continue;
        }

        drawings.push(...areaDrawings.rows);
        drawingsByArea.push({
          drawingAreaId: areaRecord?.id,
          drawingAreaName: areaRecord?.name,
          count: areaDrawings.rows.length,
          drawings: areaDrawings.rows,
          summary: areaDrawings.rows.map((row) => summarizeDrawing(row, areaRecord, drawingSetNameById)),
        });
      }
    }

    return NextResponse.json({
      success: true,
      partialSuccess: warnings.length > 0,
      companyId,
      projectId,
      perPage,
      maxPages,
      counts: {
        drawingAreas: areasResult.rows.length,
        drawingSets: setsResult.rows.length,
        drawingUploads: uploadsResult.rows.length,
        drawings: drawings.length,
      },
      drawingAreas: areasResult.rows,
      drawingSets: setsResult.rows,
      drawingUploads: uploadsResult.rows,
      drawings,
      drawingsSummary: drawingsByArea.flatMap((area) => Array.isArray(area.summary) ? area.summary : []),
      drawingsByArea,
      warnings,
      rawPages: {
        drawingAreas: areasResult.rawPages,
        drawingSets: setsResult.rawPages,
        drawingUploads: uploadsResult.rawPages,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = Number((error as { status?: number })?.status || 500);
    return NextResponse.json(
      {
        error: "Failed to fetch drawings inventory",
        details: message,
        procoreDetails: (error as { details?: unknown })?.details,
      },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}

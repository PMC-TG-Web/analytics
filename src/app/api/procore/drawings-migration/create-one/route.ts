import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getClientCredentialsToken, procoreConfig } from "@/lib/procore";

type UnknownRecord = Record<string, unknown>;

function readStr(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as UnknownRecord)[key];
}

function rowsFromPayload(data: unknown): UnknownRecord[] {
  const rows = Array.isArray(data) ? data : Array.isArray(field(data, "data")) ? (field(data, "data") as unknown[]) : [];
  return rows.filter((row): row is UnknownRecord => Boolean(row && typeof row === "object" && !Array.isArray(row)));
}

function normalizeDrawingNumber(value: unknown): string {
  return readStr(value).toLowerCase();
}

function readPdfUrl(drawing: UnknownRecord): string {
  const pdfFields = field(drawing, "pdfFields");
  const direct =
    field(drawing, "pdfUrl") ||
    field(drawing, "pdf_url") ||
    field(pdfFields, "current_revision.pdf_url") ||
    field(pdfFields, "pdf_url") ||
    field(pdfFields, "download_url");
  return readStr(direct);
}

function filenameForDrawing(drawing: UnknownRecord): string {
  const number = readStr(field(drawing, "number")).replace(/[\\/:*?"<>|]+/g, "-");
  const title = readStr(field(drawing, "title")).replace(/[\\/:*?"<>|]+/g, "-");
  const base = [number, title].filter(Boolean).join(" - ") || `drawing-${readStr(field(drawing, "id")) || "migration"}`;
  return `${base}.pdf`;
}

function normalizeDate(value: unknown): string {
  const text = readStr(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = text ? new Date(text) : new Date();
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

async function getToken(bodyToken?: unknown) {
  const cookieStore = await cookies();
  const explicitToken = readStr(bodyToken);
  const cookieToken = readStr(cookieStore.get("procore_access_token")?.value);
  if (explicitToken || cookieToken) return explicitToken || cookieToken;
  return getClientCredentialsToken();
}

async function validateTargetProjectId(companyId: string, targetProjectId: string) {
  const bidBoardKey = targetProjectId.includes(":") ? targetProjectId : `${companyId}:${targetProjectId}`;
  const bidBoardProject = await prisma.pmcBidBoardProject.findFirst({
    where: {
      companyId,
      OR: [
        { bidBoardId: targetProjectId },
        { bidBoardId: bidBoardKey },
      ],
    },
    select: {
      bidBoardId: true,
      procoreProjectId: true,
      projectName: true,
      status: true,
    },
  });

  if (bidBoardProject && !bidBoardProject.procoreProjectId) {
    return {
      ok: false,
      error: "Target ID is a bid board ID, not a Procore project ID.",
      details:
        "The Drawings API only works after the bid-board job is converted/linked to a real Procore project.",
      bidBoardProject,
    };
  }

  if (bidBoardProject?.procoreProjectId && bidBoardProject.procoreProjectId !== targetProjectId) {
    return {
      ok: false,
      error: "Target ID is a bid board ID. Use the linked Procore project ID instead.",
      details: `Use target project ID ${bidBoardProject.procoreProjectId}.`,
      bidBoardProject,
    };
  }

  return { ok: true };
}

async function procoreFetch({
  path,
  method = "GET",
  companyId,
  accessToken,
  body,
}: {
  path: string;
  method?: string;
  companyId: string;
  accessToken: string;
  body?: unknown;
}) {
  const apiBase = (procoreConfig.apiUrl || "https://api.procore.com").replace(/\/$/, "");
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Procore-Company-Id": companyId,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  const text = await response.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Keep raw text for diagnostics.
  }

  if (!response.ok) {
    const error = new Error(`Procore ${method} ${path} failed (${response.status})`) as Error & {
      status?: number;
      details?: unknown;
      path?: string;
      requestBody?: unknown;
    };
    error.status = response.status;
    error.details = data;
    error.path = path;
    error.requestBody = body;
    throw error;
  }

  return data;
}

async function findOrCreateDrawingArea({
  projectId,
  companyId,
  accessToken,
  name,
}: {
  projectId: string;
  companyId: string;
  accessToken: string;
  name: string;
}) {
  const areas = rowsFromPayload(
    await procoreFetch({
      path: `/rest/v1.0/projects/${encodeURIComponent(projectId)}/drawing_areas?page=1&per_page=100`,
      companyId,
      accessToken,
    })
  );
  const match = areas.find((area) => readStr(field(area, "name")).toLowerCase() === name.toLowerCase());
  if (match) return { created: false, area: match };

  const created = await procoreFetch({
    path: `/rest/v1.0/projects/${encodeURIComponent(projectId)}/drawing_areas`,
    method: "POST",
    companyId,
    accessToken,
    body: { drawing_area: { name } },
  });
  return { created: true, area: created as UnknownRecord };
}

async function findOrCreateDrawingSet({
  projectId,
  companyId,
  accessToken,
  name,
  date,
}: {
  projectId: string;
  companyId: string;
  accessToken: string;
  name: string;
  date: string;
}) {
  const sets = rowsFromPayload(
    await procoreFetch({
      path: `/rest/v1.0/projects/${encodeURIComponent(projectId)}/drawing_sets?page=1&per_page=100`,
      companyId,
      accessToken,
    })
  );
  const match = sets.find((set) => readStr(field(set, "name")).toLowerCase() === name.toLowerCase());
  if (match) return { created: false, set: match };

  const created = await procoreFetch({
    path: `/rest/v1.0/projects/${encodeURIComponent(projectId)}/drawing_sets`,
    method: "POST",
    companyId,
    accessToken,
    body: { name, date },
  });
  return { created: true, set: created as UnknownRecord };
}

async function findOrCreateDrawing({
  projectId,
  companyId,
  accessToken,
  drawingAreaId,
  number,
  title,
  disciplineName,
}: {
  projectId: string;
  companyId: string;
  accessToken: string;
  drawingAreaId: string;
  number: unknown;
  title: unknown;
  disciplineName: string;
}) {
  const drawingNumber = readStr(number);
  if (!drawingNumber) {
    throw new Error("Drawing number is required to create or reuse a target drawing.");
  }

  const drawings = rowsFromPayload(
    await procoreFetch({
      path: `/rest/v1.1/drawing_areas/${encodeURIComponent(drawingAreaId)}/drawings?project_id=${encodeURIComponent(
        projectId
      )}&page=1&per_page=100`,
      companyId,
      accessToken,
    })
  );
  const normalizedNumber = normalizeDrawingNumber(drawingNumber);
  const match = drawings.find((drawing) => normalizeDrawingNumber(field(drawing, "number")) === normalizedNumber);
  if (match) {
    return { created: false, drawing: match, reusedReason: "number_match" };
  }

  try {
    const created = (await procoreFetch({
      path: `/rest/v1.1/drawing_areas/${encodeURIComponent(drawingAreaId)}/drawings?project_id=${encodeURIComponent(projectId)}`,
      method: "POST",
      companyId,
      accessToken,
      body: {
        drawing: {
          number: drawingNumber,
          title,
          drawing_discipline: { name: disciplineName },
        },
      },
    })) as UnknownRecord;
    return { created: true, drawing: created, reusedReason: null };
  } catch (error) {
    const details = (error as { details?: unknown })?.details;
    const errorText = JSON.stringify(details || "");
    if (Number((error as { status?: number })?.status || 0) === 422 && /already been taken/i.test(errorText)) {
      const retryDrawings = rowsFromPayload(
        await procoreFetch({
          path: `/rest/v1.1/drawing_areas/${encodeURIComponent(drawingAreaId)}/drawings?project_id=${encodeURIComponent(
            projectId
          )}&page=1&per_page=100`,
          companyId,
          accessToken,
        })
      );
      const retryMatch = retryDrawings.find(
        (drawing) => normalizeDrawingNumber(field(drawing, "number")) === normalizedNumber
      );
      if (retryMatch) {
        return { created: false, drawing: retryMatch, reusedReason: "number_match_after_create_conflict" };
      }
    }
    throw error;
  }
}

async function uploadPdfToProcore({
  projectId,
  companyId,
  accessToken,
  fileName,
  pdfBytes,
}: {
  projectId: string;
  companyId: string;
  accessToken: string;
  fileName: string;
  pdfBytes: ArrayBuffer;
}) {
  const createUpload = (await procoreFetch({
    path: `/rest/v1.1/projects/${encodeURIComponent(projectId)}/uploads`,
    method: "POST",
    companyId,
    accessToken,
    body: {
      response_filename: fileName,
      response_content_type: "application/pdf",
    },
  })) as UnknownRecord;

  const uploadUrl = readStr(field(createUpload, "url"));
  const uploadUuid = readStr(field(createUpload, "uuid"));
  const fields = field(createUpload, "fields");

  if (!uploadUrl || !uploadUuid || !fields || typeof fields !== "object") {
    throw new Error("Create Project Upload did not return url, uuid, and fields.");
  }

  const form = new FormData();
  for (const [key, value] of Object.entries(fields as Record<string, unknown>)) {
    form.append(key, readStr(value));
  }
  form.append("file", new Blob([pdfBytes], { type: "application/pdf" }), fileName);

  const storageResponse = await fetch(uploadUrl, {
    method: "POST",
    body: form,
    cache: "no-store",
  });

  const storageText = await storageResponse.text().catch(() => "");
  if (!storageResponse.ok) {
    const error = new Error(`Storage upload failed (${storageResponse.status})`) as Error & {
      status?: number;
      details?: unknown;
    };
    error.status = storageResponse.status;
    error.details = storageText;
    throw error;
  }

  return { uploadUuid, createUpload, storageStatus: storageResponse.status };
}

async function createDrawingUploadWithFallback({
  projectId,
  companyId,
  accessToken,
  payload,
}: {
  projectId: string;
  companyId: string;
  accessToken: string;
  payload: UnknownRecord;
}) {
  const attempts: Array<{
    label: string;
    path: string;
    payload: unknown;
    status?: number;
    details?: unknown;
  }> = [];

  const pathVersions = ["v1.1", "v1.0"];
  const payloadVariants: Array<{ label: string; payload: unknown }> = [
    { label: "direct", payload },
    { label: "wrapped", payload: { drawing_upload: payload } },
  ];

  for (const version of pathVersions) {
    const path = `/rest/${version}/projects/${encodeURIComponent(projectId)}/drawing_uploads`;
    for (const variant of payloadVariants) {
      try {
        const result = await procoreFetch({
          path,
          method: "POST",
          companyId,
          accessToken,
          body: variant.payload,
        });
        return {
          result,
          attempts: [
            ...attempts,
            {
              label: `${version}:${variant.label}`,
              path,
              payload: variant.payload,
              status: 201,
            },
          ],
        };
      } catch (error) {
        const status = Number((error as { status?: number })?.status || 0);
        attempts.push({
          label: `${version}:${variant.label}`,
          path,
          payload: variant.payload,
          status,
          details: (error as { details?: unknown })?.details,
        });

        if (status === 401 || status === 403) {
          throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
            attempts,
          });
        }
      }
    }
  }

  const lastAttempt = attempts[attempts.length - 1];
  const error = new Error(`Procore drawing upload failed after ${attempts.length} payload attempt(s).`) as Error & {
    status?: number;
    details?: unknown;
    path?: string;
    requestBody?: unknown;
    attempts?: typeof attempts;
  };
  error.status = lastAttempt?.status || 400;
  error.details = lastAttempt?.details;
  error.path = lastAttempt?.path;
  error.requestBody = lastAttempt?.payload;
  error.attempts = attempts;
  throw error;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as UnknownRecord;
    const drawing = field(body, "drawing");

    if (!drawing || typeof drawing !== "object") {
      return NextResponse.json({ error: "Missing drawing payload." }, { status: 400 });
    }

    const drawingRecord = drawing as UnknownRecord;
    const sourceCompanyId = readStr(field(body, "sourceCompanyId"));
    const sourceProjectId = readStr(field(body, "sourceProjectId"));
    const targetCompanyId = readStr(field(body, "targetCompanyId"));
    const targetProjectId = readStr(field(body, "targetProjectId"));
    const targetDrawingSetName = readStr(field(body, "targetDrawingSetName")) || "Migrated Drawings";
    const targetDisciplineName = readStr(field(body, "targetDisciplineName")) || "General";
    const revision = readStr(field(drawingRecord, "revision")) || "0";
    const drawingDate = normalizeDate(field(drawingRecord, "drawingDate"));
    const pdfUrl = readPdfUrl(drawingRecord);
    const fileName = filenameForDrawing(drawingRecord);

    if (!sourceCompanyId || !sourceProjectId || !targetCompanyId || !targetProjectId) {
      return NextResponse.json(
        { error: "sourceCompanyId, sourceProjectId, targetCompanyId, and targetProjectId are required." },
        { status: 400 }
      );
    }
    if (sourceCompanyId === targetCompanyId && sourceProjectId === targetProjectId) {
      return NextResponse.json(
        {
          error: "Source and target project are the same.",
          details:
            "Create One is only for copying a drawing into a different real Procore project. For bid-board projects, use the Bid Project Documents flow instead.",
        },
        { status: 400 }
      );
    }
    if (!pdfUrl || !/^https:\/\//i.test(pdfUrl)) {
      return NextResponse.json({ error: "Drawing is missing a valid PDF URL." }, { status: 400 });
    }

    const targetValidation = await validateTargetProjectId(targetCompanyId, targetProjectId);
    if (!targetValidation.ok) {
      return NextResponse.json(targetValidation, { status: 400 });
    }

    const accessToken = await getToken(field(body, "accessToken"));
    const pdfResponse = await fetch(pdfUrl, { redirect: "follow", cache: "no-store" });
    if (!pdfResponse.ok) {
      return NextResponse.json(
        { error: "Source PDF download failed.", status: pdfResponse.status },
        { status: 502 }
      );
    }
    const pdfBytes = await pdfResponse.arrayBuffer();

    const areaName = readStr(field(drawingRecord, "drawingAreaName")) || "Migrated Drawings";
    const areaResult = await findOrCreateDrawingArea({
      projectId: targetProjectId,
      companyId: targetCompanyId,
      accessToken,
      name: areaName,
    });
    const targetDrawingAreaId = readStr(field(areaResult.area, "id"));
    if (!targetDrawingAreaId) throw new Error("Target drawing area did not return an id.");

    const setResult = await findOrCreateDrawingSet({
      projectId: targetProjectId,
      companyId: targetCompanyId,
      accessToken,
      name: targetDrawingSetName,
      date: drawingDate,
    });
    const targetDrawingSetId = readStr(field(setResult.set, "id"));
    if (!targetDrawingSetId) throw new Error("Target drawing set did not return an id.");

    const targetDrawingResult = await findOrCreateDrawing({
      projectId: targetProjectId,
      companyId: targetCompanyId,
      accessToken,
      drawingAreaId: targetDrawingAreaId,
      number: field(drawingRecord, "number"),
      title: field(drawingRecord, "title"),
      disciplineName: targetDisciplineName,
    });
    const targetDrawing = targetDrawingResult.drawing;
    const targetDrawingId = readStr(field(targetDrawing, "id"));
    if (!targetDrawingId) throw new Error("Target drawing did not return an id.");

    const uploaded = await uploadPdfToProcore({
      projectId: targetProjectId,
      companyId: targetCompanyId,
      accessToken,
      fileName,
      pdfBytes,
    });

    const drawingUploadPayload = {
      drawing_area_id: targetDrawingAreaId,
      drawing_set_id: targetDrawingSetId,
      drawing_log_imports: [
        {
          drawing_id: targetDrawingId,
          upload_uuid: uploaded.uploadUuid,
          drawing_date: drawingDate,
          default_revision: revision,
        },
      ],
    };

    const drawingUploadResponse = await createDrawingUploadWithFallback({
      projectId: targetProjectId,
      companyId: targetCompanyId,
      accessToken,
      payload: drawingUploadPayload,
    });
    const drawingUpload = drawingUploadResponse.result;

    return NextResponse.json({
      success: true,
      source: {
        companyId: sourceCompanyId,
        projectId: sourceProjectId,
        drawingId: field(drawingRecord, "id"),
        drawingNumber: field(drawingRecord, "number"),
        title: field(drawingRecord, "title"),
        pdfBytes: pdfBytes.byteLength,
      },
      target: {
        companyId: targetCompanyId,
        projectId: targetProjectId,
        drawingArea: { created: areaResult.created, id: targetDrawingAreaId, name: areaName },
        drawingSet: { created: setResult.created, id: targetDrawingSetId, name: targetDrawingSetName },
        drawing: {
          created: targetDrawingResult.created,
          reusedReason: targetDrawingResult.reusedReason,
          record: targetDrawing,
        },
        uploadUuid: uploaded.uploadUuid,
        drawingUpload,
        drawingUploadAttempts: drawingUploadResponse.attempts,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = Number((error as { status?: number })?.status || 500);
    return NextResponse.json(
      {
        error: "Drawing migration create-one failed.",
        details: message,
        procorePath: (error as { path?: string })?.path,
        procoreDetails: (error as { details?: unknown })?.details,
        attemptedPayload: (error as { requestBody?: unknown })?.requestBody,
        attempts: (error as { attempts?: unknown })?.attempts,
        hint:
          status === 400
            ? "If Procore says the revision already exists, change Target Drawing Set Name or use a new drawing date/revision for the retry."
            : undefined,
      },
      { status: status >= 400 && status < 600 ? status : 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

function nestedField(value: unknown, firstKey: string, secondKey: string): unknown {
  return field(field(value, firstKey), secondKey);
}

function inferSourceDrawingSetName(drawing: UnknownRecord): string {
  return (
    readStr(field(drawing, "drawingSetName")) ||
    readStr(field(drawing, "folder")) ||
    readStr(field(drawing, "folderName")) ||
    readStr(field(drawing, "folder_name")) ||
    readStr(nestedField(drawing, "drawing_set", "name")) ||
    readStr(nestedField(drawing, "drawingSet", "name"))
  );
}

function filenameForDrawing(drawing: UnknownRecord): string {
  const number = readStr(field(drawing, "number")).replace(/[\\/:*?"<>|]+/g, "-");
  const title = readStr(field(drawing, "title")).replace(/[\\/:*?"<>|]+/g, "-");
  const base = [number, title].filter(Boolean).join(" - ") || `drawing-${readStr(field(drawing, "id")) || "migration"}`;
  return `${base}.pdf`;
}

async function readTargetProjectWarning(companyId: string, targetProjectId: string) {
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
      type: "bid_board_without_project_id",
      message:
        "Target ID is a bid board ID, not a Procore project ID. Convert/link this bid-board job to a real Procore project before creating drawings.",
      bidBoardProject,
    };
  }

  if (bidBoardProject?.procoreProjectId && bidBoardProject.procoreProjectId !== targetProjectId) {
    return {
      type: "bid_board_with_linked_project_id",
      message: `Target ID is a bid board ID. Use linked Procore project ID ${bidBoardProject.procoreProjectId}.`,
      bidBoardProject,
    };
  }

  return null;
}

async function probePdf(pdfUrl: string) {
  const headResponse = await fetch(pdfUrl, {
    method: "HEAD",
    redirect: "follow",
    cache: "no-store",
  }).catch(() => null);

  if (headResponse?.ok) {
    return {
      ok: true,
      method: "HEAD",
      status: headResponse.status,
      contentType: headResponse.headers.get("content-type"),
      contentLength: headResponse.headers.get("content-length"),
    };
  }

  const rangeResponse = await fetch(pdfUrl, {
    method: "GET",
    headers: { Range: "bytes=0-65535" },
    redirect: "follow",
    cache: "no-store",
  });

  const sample = await rangeResponse.arrayBuffer();
  return {
    ok: rangeResponse.ok,
    method: "GET range",
    status: rangeResponse.status,
    contentType: rangeResponse.headers.get("content-type"),
    contentLength: rangeResponse.headers.get("content-length"),
    contentRange: rangeResponse.headers.get("content-range"),
    sampleBytes: sample.byteLength,
  };
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
    const targetDrawingSetName = readStr(field(body, "targetDrawingSetName")) || inferSourceDrawingSetName(drawingRecord) || "Migrated Drawings";
    const pdfUrl = readPdfUrl(drawingRecord);

    if (!sourceCompanyId) {
      return NextResponse.json({ error: "Missing sourceCompanyId." }, { status: 400 });
    }
    if (!sourceProjectId) {
      return NextResponse.json({ error: "Missing sourceProjectId." }, { status: 400 });
    }
    if (!targetCompanyId) {
      return NextResponse.json({ error: "Missing targetCompanyId." }, { status: 400 });
    }
    if (!targetProjectId) {
      return NextResponse.json({ error: "Missing targetProjectId." }, { status: 400 });
    }
    if (!pdfUrl || !/^https:\/\//i.test(pdfUrl)) {
      return NextResponse.json({ error: "Drawing is missing a valid PDF URL." }, { status: 400 });
    }

    const pdfProbe = await probePdf(pdfUrl);
    const targetWarning = await readTargetProjectWarning(targetCompanyId, targetProjectId);

    if (!pdfProbe.ok) {
      return NextResponse.json(
        {
          error: "PDF URL was not reachable.",
          pdfProbe,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      dryRun: true,
      source: {
        companyId: sourceCompanyId,
        projectId: sourceProjectId,
        drawingId: field(drawingRecord, "id"),
        drawingNumber: field(drawingRecord, "number"),
        title: field(drawingRecord, "title"),
        drawingAreaId: field(drawingRecord, "drawingAreaId"),
        drawingAreaName: field(drawingRecord, "drawingAreaName"),
        drawingSetId: field(drawingRecord, "drawingSetId"),
        drawingSetName: field(drawingRecord, "drawingSetName"),
        revision: field(drawingRecord, "revision"),
        pdfUrl,
      },
      targetPlan: {
        companyId: targetCompanyId,
        projectId: targetProjectId,
        warning: targetWarning,
        drawingAreaName: readStr(field(drawingRecord, "drawingAreaName")) || "Migrated Drawings",
        drawingSetName: targetDrawingSetName,
        fileName: filenameForDrawing(drawingRecord),
        drawingPayloadDraft: {
          number: field(drawingRecord, "number"),
          title: field(drawingRecord, "title"),
        },
      },
      pdfProbe,
      nextStep:
        "Dry run only. The create step should upload this PDF through Procore file upload flow and then create/import the target drawing.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "Drawing migration dry run failed.", details: message }, { status: 500 });
  }
}

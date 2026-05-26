import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const SINGLE_ALLOWED_PROCORE_COMPANY_ID = '598134325805519';

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

function parseIds(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((v) => String(v).trim()).filter(Boolean);
  }
  const text = readText(input);
  if (!text) return [];
  return text
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function resolveCompanyId(input: unknown, cookieCompanyId: unknown): string {
  const requested = readText(input || cookieCompanyId || procoreConfig.companyId || "");
  if (requested && requested !== SINGLE_ALLOWED_PROCORE_COMPANY_ID) {
    return "__FORBIDDEN__";
  }
  return requested || SINGLE_ALLOWED_PROCORE_COMPANY_ID;
}

async function checkIdsFromDb(params: { companyId: string; ids: string[] }) {
  const { companyId, ids } = params;

  const stagingRows = await prisma.procoreProjectStaging.findMany({
    where: {
      companyId,
      source: 'procore_v1_projects',
      OR: [
        { procoreProjectId: { in: ids } },
        { externalId: { in: ids } },
      ],
    },
    select: {
      procoreProjectId: true,
      externalId: true,
      displayName: true,
      name: true,
      projectNumber: true,
      status: true,
      syncedAt: true,
    },
  });

  const stagingById = new Map<string, (typeof stagingRows)[number]>();
  for (const row of stagingRows) {
    const procoreId = String(row.procoreProjectId || '').trim();
    const externalId = String(row.externalId || '').trim();
    if (procoreId) stagingById.set(procoreId, row);
    if (externalId) stagingById.set(externalId, row);
  }

  return ids.map((id) => {
    const staging = stagingById.get(id);
    if (staging) {
      return {
        id,
        exists: true,
        source: "db",
        httpStatus: 200,
        projectName: staging.name || staging.displayName || null,
        displayName: staging.displayName || null,
        projectNumber: staging.projectNumber || null,
        stage: staging.status || null,
        active: true,
        updatedAt: staging.syncedAt?.toISOString() || null,
      };
    }

    return {
      id,
      exists: false,
      source: "db",
      httpStatus: 404,
    };
  });
}

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const { searchParams } = new URL(request.url);

    const companyId = resolveCompanyId(searchParams.get("companyId"), cookieStore.get("procore_company_id")?.value);
    const ids = parseIds(searchParams.get("ids"));

    if (companyId === "__FORBIDDEN__") {
      return NextResponse.json({ success: false, error: "Forbidden company context for this deployment." }, { status: 403 });
    }

    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
    }

    if (ids.length === 0) {
      return NextResponse.json(
        { success: false, error: "Provide IDs in query param: ?ids=1,2,3" },
        { status: 400 }
      );
    }

    const results = await checkIdsFromDb({ companyId, ids });
    return NextResponse.json({ success: true, source: "db", companyId, count: results.length, results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to check project IDs", details: message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const cookieStore = await cookies();

    const companyId = resolveCompanyId(body?.companyId, cookieStore.get("procore_company_id")?.value);
    const ids = parseIds(body?.ids);

    if (companyId === "__FORBIDDEN__") {
      return NextResponse.json({ success: false, error: "Forbidden company context for this deployment." }, { status: 403 });
    }

    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
    }

    if (ids.length === 0) {
      return NextResponse.json(
        { success: false, error: "Provide IDs in body: { ids: [\"1\", \"2\"] }" },
        { status: 400 }
      );
    }

    const results = await checkIdsFromDb({ companyId, ids });
    return NextResponse.json({ success: true, source: "db", companyId, count: results.length, results });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to check project IDs", details: message },
      { status: 500 }
    );
  }
}

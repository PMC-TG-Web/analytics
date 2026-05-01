import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

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
  return readText(
    input ||
      cookieCompanyId ||
      procoreConfig.companyId ||
      process.env.PROCORE_COMPANY_ID ||
      process.env.NEXT_PUBLIC_PROCORE_COMPANY_ID ||
      ""
  );
}

async function checkIdsFromDb(params: { companyId: string; ids: string[] }) {
  const { companyId, ids } = params;

  // Query project feed by procore_id matching the requested IDs
  const feedRows = await prisma.procoreProjectFeed.findMany({
    where: {
      companyId,
      procoreId: { in: ids },
      softDeleted: false,
    },
    select: {
      procoreId: true,
      projectName: true,
      status: true,
      updatedAt: true,
    },
  });

  // Also check project staging for any not found in feed
  const foundIds = new Set(feedRows.map((r) => r.procoreId).filter(Boolean) as string[]);
  const missingIds = ids.filter((id) => !foundIds.has(id));

  const stagingRows = missingIds.length > 0
    ? await prisma.procoreProjectStaging.findMany({
        where: {
          companyId,
          procoreProjectId: { in: missingIds },
        },
        select: {
          procoreProjectId: true,
          displayName: true,
          name: true,
          projectNumber: true,
          status: true,
          updatedAt: true,
        },
      })
    : [];

  const stagingById = new Map(stagingRows.map((r) => [r.procoreProjectId, r]));

  return ids.map((id) => {
    const feed = feedRows.find((r) => r.procoreId === id);
    if (feed) {
      return {
        id,
        exists: true,
        source: "db",
        httpStatus: 200,
        projectName: feed.projectName || null,
        displayName: feed.projectName || null,
        projectNumber: null,
        stage: feed.status || null,
        active: true,
        updatedAt: feed.updatedAt?.toISOString() || null,
      };
    }

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
        updatedAt: staging.updatedAt?.toISOString() || null,
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

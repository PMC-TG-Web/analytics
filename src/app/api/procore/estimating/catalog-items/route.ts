// DB-first: reads from procore_estimating_catalog_item_staging by catalog_id
// (populated by /api/procore/sync/estimating-catalog-item)
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { procoreConfig } from "@/lib/procore";

export const dynamic = "force-dynamic";

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const cookieStore = await cookies();

    const companyId = readText(
      body?.companyId ||
        cookieStore.get("procore_company_id")?.value ||
        procoreConfig.companyId ||
        ""
    );
    const catalogId = readText(body?.catalogId);
    const page = Math.max(Number(body?.page) || 1, 1);
    const perPage = Math.min(Math.max(Number(body?.perPage) || 100, 1), 500);

    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
    }

    if (!catalogId) {
      return NextResponse.json({ success: false, error: "Missing catalogId." }, { status: 400 });
    }

    const offset = (page - 1) * perPage;

    const rows = await prisma.procoreEstimatingCatalogItemStaging.findMany({
      where: {
        companyId,
        catalogId,
      },
      orderBy: { name: "asc" },
      skip: offset,
      take: perPage,
    });

    const items = rows.map((r) => r.payload);

    return NextResponse.json({
      success: true,
      source: "db",
      companyId,
      catalogId,
      page,
      perPage,
      syncedAt: rows[0]?.syncedAt ?? null,
      count: items.length,
      data: items,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch estimating catalog items", details: message },
      { status: 500 }
    );
  }
}

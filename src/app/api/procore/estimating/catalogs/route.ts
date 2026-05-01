// DB-first: reads from procore_estimating_catalogs_live (populated by /api/procore/sync/estimating-catalogs)
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

    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
    }

    const rows = await prisma.procore_estimating_catalogs_live.findMany({
      where: { company_id: companyId },
      orderBy: { name: "asc" },
    });

    // Collect unique catalog IDs for downstream use
    const catalogIds = rows.map((r) => r.catalog_id);
    const allCatalogNodeIds = [...catalogIds];

    return NextResponse.json({
      success: true,
      source: "db",
      companyId,
      syncedAt: rows[0]?.synced_at ?? null,
      count: rows.length,
      catalogIds,
      allCatalogNodeIds,
      data: rows.map((r) => r.payload),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch estimating catalogs", details: message },
      { status: 500 }
    );
  }
}

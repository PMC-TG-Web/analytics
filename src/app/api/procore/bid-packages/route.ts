// Serves Procore bid packages from the database (bidpackages table).
// Direct Procore API calls removed — run POST /api/procore/sync/bid-packages to populate.
import { NextResponse } from "next/server";
import { procoreConfig } from "@/lib/procore";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = String(url.searchParams.get("projectId") || "").trim();
    const companyId = String(url.searchParams.get("companyId") || procoreConfig.companyId || "").trim();
    const page = Math.max(1, Number.parseInt(String(url.searchParams.get("page") || "1"), 10) || 1);
    const perPage = Math.min(100, Math.max(1, Number.parseInt(String(url.searchParams.get("perPage") || "100"), 10) || 100));

    if (!projectId) {
      return NextResponse.json({ success: false, error: "Missing projectId." }, { status: 400 });
    }

    type Row = { payload: unknown };
    const offset = (page - 1) * perPage;
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT payload FROM bidpackages
       WHERE project_id = $1 AND company_id = $2
       ORDER BY synced_at DESC
       LIMIT $3 OFFSET $4`,
      projectId, companyId, perPage, offset
    );

    const bidPackages = rows.map((r) => r.payload);

    return NextResponse.json({
      success: true,
      source: "database",
      projectId,
      page,
      perPage,
      count: bidPackages.length,
      bidPackages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ success: false, error: "Failed to read bid packages from database", details: message }, { status: 500 });
  }
}

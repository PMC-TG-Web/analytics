// Serves Procore bids from the database (bids table).
// Direct Procore API calls removed — run POST /api/procore/sync/bids to populate.
import { NextResponse } from "next/server";
import { procoreConfig } from "@/lib/procore";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = String(searchParams.get("projectId") || "").trim();
    const companyId = String(searchParams.get("companyId") || procoreConfig.companyId || "").trim();
    const page = Math.max(Number(searchParams.get("page")) || 1, 1);
    const perPage = Math.min(Math.max(Number(searchParams.get("perPage")) || 100, 1), 200);

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: "Missing projectId." },
        { status: 400 }
      );
    }

    type Row = { payload: unknown };
    const offset = (page - 1) * perPage;
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT payload FROM bids
       WHERE project_id = $1 AND company_id = $2
       ORDER BY synced_at DESC
       LIMIT $3 OFFSET $4`,
      projectId, companyId, perPage, offset
    );

    const bids = rows.map((r) => r.payload);

    return NextResponse.json({
      success: true,
      source: "database",
      projectId,
      page,
      perPage,
      count: bids.length,
      bids,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to read bids from database", details: message },
      { status: 500 }
    );
  }
}

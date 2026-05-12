// Serves Procore change order packages from the database (procore_change_order_packages).
// Direct Procore API calls removed — run POST /api/procore/sync/change-order-packages to populate.
import { NextResponse } from "next/server";
import { procoreConfig } from "@/lib/procore";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

function parseCsv(input: unknown): string[] {
  const text = readText(input);
  if (!text) return [];
  return text.split(",").map((v) => v.trim()).filter(Boolean);
}

function toSafePositiveInt(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const companyId = readText(searchParams.get("companyId") || procoreConfig.companyId);
    const projectId = readText(searchParams.get("projectId"));
    const contractId = readText(searchParams.get("contractId"));
    const statusFilters = parseCsv(searchParams.get("status"));
    const page = toSafePositiveInt(searchParams.get("page"), 1, 200);
    const perPage = toSafePositiveInt(searchParams.get("perPage"), 100, 200);

    if (!companyId) {
      return NextResponse.json({ error: "Missing companyId." }, { status: 400 });
    }
    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId." }, { status: 400 });
    }

    type Row = { payload: unknown };
    let rows: Row[];

    const statusClause = statusFilters.length > 0
      ? `AND status = ANY(ARRAY[${statusFilters.map((s) => `'${s.replace(/'/g, "''")}'`).join(",")}])`
      : "";
    const contractClause = contractId ? `AND contract_id = '${contractId.replace(/'/g, "''")}'` : "";
    const offset = (page - 1) * perPage;

    rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT payload FROM procore_change_order_packages
       WHERE company_id = $1 AND project_id = $2 ${contractClause} ${statusClause}
       ORDER BY synced_at DESC
       LIMIT $3 OFFSET $4`,
      companyId, projectId, perPage, offset
    );

    const data = rows.map((r) => r.payload);

    return NextResponse.json({
      success: true,
      source: "database",
      companyId,
      projectId,
      page,
      perPage,
      count: data.length,
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to read change order packages from database", details: message }, { status: 500 });
  }
}

// Serves Procore prime contracts from the database (procore_prime_contracts_live).
// Direct Procore API calls removed — run POST /api/procore/sync/prime-contracts to populate.
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

async function queryPrimeContracts(companyId: string, projectId: string, filterIds: string[]) {
  type Row = { payload: unknown; prime_contract_id: string; synced_at: Date };

  let rows: Row[];
  if (filterIds.length > 0) {
    rows = await prisma.$queryRaw<Row[]>`
      SELECT prime_contract_id, payload, synced_at
      FROM procore_prime_contracts_live
      WHERE company_id = ${companyId}
        AND project_procore_id = ${projectId}
        AND prime_contract_id = ANY(${filterIds})
      ORDER BY synced_at DESC
    `;
  } else {
    rows = await prisma.$queryRaw<Row[]>`
      SELECT prime_contract_id, payload, synced_at
      FROM procore_prime_contracts_live
      WHERE company_id = ${companyId}
        AND project_procore_id = ${projectId}
      ORDER BY synced_at DESC
    `;
  }
  return rows.map((r) => r.payload);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const companyId = readText(
      searchParams.get("companyId") || procoreConfig.companyId
    );
    const projectId = readText(searchParams.get("projectId"));
    const filterIds = parseCsv(searchParams.get("filterIds") || searchParams.get("filters[id]"));

    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
    }
    if (!projectId) {
      return NextResponse.json({ success: false, error: "Missing projectId." }, { status: 400 });
    }

    const data = await queryPrimeContracts(companyId, projectId, filterIds);

    return NextResponse.json({
      success: true,
      companyId,
      projectId,
      source: "database",
      count: data.length,
      data,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to read prime contracts from database", details: message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const companyId = readText(body?.companyId || procoreConfig.companyId);
    const projectId = readText(body?.projectId);
    const filterIds = Array.isArray(body?.filterIds)
      ? (body.filterIds as unknown[]).map((v) => String(v).trim()).filter(Boolean)
      : parseCsv(body?.filterIds);

    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
    }
    if (!projectId) {
      return NextResponse.json({ success: false, error: "Missing projectId." }, { status: 400 });
    }

    const data = await queryPrimeContracts(companyId, projectId, filterIds);

    return NextResponse.json({
      success: true,
      companyId,
      projectId,
      source: "database",
      persisted: false,
      count: data.length,
      data,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to read prime contracts from database", details: message },
      { status: 500 }
    );
  }
}

// DB-first: reads from procore_company_vendors_live (populated by /api/procore/sync/vendors)
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { procoreConfig } from "@/lib/procore";

export const dynamic = "force-dynamic";

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

function toPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
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

    const page = toPositiveInt(body?.page, 1, 1, 1000);
    const perPage = toPositiveInt(body?.perPage, 100, 1, 1000);
    const offset = (page - 1) * perPage;

    const rows = await prisma.procore_company_vendors_live.findMany({
      where: { company_id: companyId },
      orderBy: { name: "asc" },
      skip: offset,
      take: perPage,
    });

    return NextResponse.json({
      success: true,
      source: "db",
      companyId,
      page,
      perPage,
      syncedAt: rows[0]?.synced_at ?? null,
      count: rows.length,
      vendors: rows.map((r) => r.payload),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch vendors", details: message },
      { status: 500 }
    );
  }
}

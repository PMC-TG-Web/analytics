import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { procoreConfig } from "@/lib/procore";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

async function queryProjectStages(params: {
  companyId: string;
  page: number;
  perPage: number;
}) {
  const { companyId, page, perPage } = params;
  const offset = (Math.max(1, page) - 1) * perPage;

  const rows = await prisma.procore_project_stages_live.findMany({
    where: { company_id: companyId },
    orderBy: { name: "asc" },
    skip: offset,
    take: perPage,
  });

  // Return the payload field to preserve full Procore shape downstream
  const data = rows.map((r) => r.payload);

  return {
    success: true,
    source: "db",
    companyId,
    syncedAt: rows[0]?.synced_at ?? null,
    page,
    perPage,
    count: data.length,
    data,
  };
}

export async function GET(request: Request) {
  try {
    const cookieStore = await cookies();
    const { searchParams } = new URL(request.url);

    const companyId = readText(
      searchParams.get("companyId") ||
        cookieStore.get("procore_company_id")?.value ||
        procoreConfig.companyId ||
        ""
    );
    const page = Number(searchParams.get("page") || 1);
    const perPage = Number(searchParams.get("perPage") || 100);

    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
    }

    const payload = await queryProjectStages({ companyId, page, perPage });
    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch project stages", details: message },
      { status: 500 }
    );
  }
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
    const page = Number(body?.page || 1);
    const perPage = Number(body?.perPage || 100);

    if (!companyId) {
      return NextResponse.json({ success: false, error: "Missing companyId." }, { status: 400 });
    }

    const payload = await queryProjectStages({ companyId, page, perPage });
    return NextResponse.json(payload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to fetch project stages", details: message },
      { status: 500 }
    );
  }
}

// Serves all Procore project details from the database (procore_project_staging).
// Direct Procore API calls removed — run POST /api/procore/sync/all-projects to populate.
import { NextResponse } from "next/server";
import { procoreConfig } from "@/lib/procore";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const SINGLE_ALLOWED_PROCORE_COMPANY_ID = '598134325805519';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const requestedCompanyId = String(body?.companyId || procoreConfig.companyId || "").trim();
    const maxProjects = typeof body?.maxProjects === "number" && body.maxProjects > 0
      ? Math.floor(body.maxProjects)
      : undefined;

    if (requestedCompanyId && requestedCompanyId !== SINGLE_ALLOWED_PROCORE_COMPANY_ID) {
      return NextResponse.json(
        { error: 'Forbidden company context for this deployment.' },
        { status: 403 }
      );
    }

    const companyId = requestedCompanyId || SINGLE_ALLOWED_PROCORE_COMPANY_ID;

    if (!companyId) {
      return NextResponse.json(
        { error: "Missing companyId." },
        { status: 400 }
      );
    }

    const rows = await prisma.procoreProjectStaging.findMany({
      where: { companyId },
      orderBy: { syncedAt: "desc" },
      take: maxProjects,
      select: { payload: true },
    });

    const details = rows.map((r) => r.payload);

    return NextResponse.json({
      success: true,
      companyId,
      source: "database",
      totalDetailsFetched: details.length,
      projects: details,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to read project details from database", details: message },
      { status: 500 }
    );
  }
}


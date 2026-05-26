import { NextResponse } from "next/server";
import { procoreConfig } from "@/lib/procore";
import { fetchCanonicalProcoreProjectPayloadById } from "@/lib/procoreProjectsCanonical";

export const dynamic = "force-dynamic";

const SINGLE_ALLOWED_PROCORE_COMPANY_ID = '598134325805519';

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const requestedCompanyId = readText(body?.companyId || procoreConfig.companyId || '');
    if (requestedCompanyId && requestedCompanyId !== SINGLE_ALLOWED_PROCORE_COMPANY_ID) {
      return NextResponse.json(
        { success: false, error: 'Forbidden company context for this deployment.' },
        { status: 403 }
      );
    }

    const companyId = requestedCompanyId || SINGLE_ALLOWED_PROCORE_COMPANY_ID;
    const projectId = readText(body?.projectId || body?.id);

    if (!projectId) {
      return NextResponse.json({ success: false, error: "Missing projectId (or id)." }, { status: 400 });
    }

    const payload = await fetchCanonicalProcoreProjectPayloadById(companyId, projectId);

    if (!payload) {
      return NextResponse.json(
        {
          success: false,
          error: "Project not found in database. Run POST /api/procore/sync/all-projects to populate data.",
          projectId,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      companyId,
      projectId,
      source: "procore_project_staging",
      data: payload,
      raw: payload,
      stored: true,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: "Failed to read project from database", details: message },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { countCanonicalProcoreProjects, fetchCanonicalProcoreProjects } from "@/lib/procoreProjectsCanonical";

const SINGLE_ALLOWED_PROCORE_COMPANY_ID = '598134325805519';

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const page = Math.max(Number(url.searchParams.get("page") || "1"), 1);
    const pageSize = Math.min(Math.max(Number(url.searchParams.get("pageSize") || "100"), 1), 500);
    const offset = (page - 1) * pageSize;
    const queryCompanyId = String(url.searchParams.get('companyId') || '').trim();
    const cookieCompanyId = String(req.cookies.get('procore_company_id')?.value || '').trim();

    if (cookieCompanyId && queryCompanyId && cookieCompanyId !== queryCompanyId) {
      return NextResponse.json(
        { success: false, error: 'Company context mismatch between session cookie and request query.' },
        { status: 403 }
      );
    }

    const resolvedCompanyId = (cookieCompanyId || queryCompanyId || SINGLE_ALLOWED_PROCORE_COMPANY_ID).trim();
    if (resolvedCompanyId !== SINGLE_ALLOWED_PROCORE_COMPANY_ID) {
      return NextResponse.json(
        { success: false, error: 'Forbidden company context for this deployment.' },
        { status: 403 }
      );
    }

    const [rows, total] = await Promise.all([
      fetchCanonicalProcoreProjects({ companyId: resolvedCompanyId, pageSize, offset }),
      countCanonicalProcoreProjects(resolvedCompanyId),
    ]);

    return NextResponse.json({
      success: true,
      page,
      pageSize,
      total,
      rows,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: "Failed to query projects-v1-live",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}

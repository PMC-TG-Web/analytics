// API endpoint to read Procore projects from the database (populated by sync/all-projects + webhooks).
// Direct Procore API calls removed — all data served from canonical Procore staging.
import { NextResponse } from "next/server";
import { procoreConfig } from "@/lib/procore";
import { fetchCanonicalProcoreProjectPayloads } from "@/lib/procoreProjectsCanonical";

export const dynamic = "force-dynamic";

async function queryProjectFeed(companyId: string) {
  return fetchCanonicalProcoreProjectPayloads(companyId);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const companyId = String(searchParams.get("companyId") || procoreConfig.companyId || "").trim();

    const projects = await queryProjectFeed(companyId);

    return NextResponse.json(projects);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "Failed to read projects from database", details: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const companyId = String(body?.companyId || procoreConfig.companyId || "").trim();

    if (!companyId) {
      return NextResponse.json(
        { error: "Missing companyId. Set PROCORE_COMPANY_ID or provide companyId in request body." },
        { status: 400 }
      );
    }

    const allProjects = await queryProjectFeed(companyId);

    return NextResponse.json({
      success: true,
      count: allProjects.length,
      projects: allProjects,
      companyId,
      source: "database",
      totalFetched: allProjects.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Failed to read Procore projects from database", details: message },
      { status: 500 }
    );
  }
}

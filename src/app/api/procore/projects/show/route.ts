import { NextResponse } from "next/server";
import { procoreConfig } from "@/lib/procore";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function readText(value: unknown): string {
  return String(value ?? "").trim();
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    const companyId = readText(
      body?.companyId ||
        procoreConfig.companyId ||
        ""
    );
    const projectId = readText(body?.projectId || body?.id);

    if (!projectId) {
      return NextResponse.json({ success: false, error: "Missing projectId (or id)." }, { status: 400 });
    }

    // Read from procore_project_staging (populated by sync/all-projects or previous show calls)
    const existing = await prisma.procoreProjectStaging.findFirst({
      where: { companyId: companyId || undefined, projectId },
      orderBy: { syncedAt: "desc" },
    });

    if (!existing) {
      // Fall back to procore_project_feed by externalId/procoreId
      const feedRow = await prisma.procoreProjectFeed.findFirst({
        where: {
          OR: [
            { externalId: projectId, companyId: companyId || undefined },
            { procoreId: projectId, companyId: companyId || undefined },
          ],
        },
        orderBy: { syncedAt: "desc" },
      });

      if (feedRow) {
        return NextResponse.json({
          success: true,
          companyId,
          projectId,
          source: "procore_project_feed",
          data: feedRow.payload,
          raw: feedRow.payload,
          stored: true,
        });
      }

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
      data: existing.payload,
      raw: existing.payload,
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

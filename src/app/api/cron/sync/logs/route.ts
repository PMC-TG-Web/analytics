import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/sync/logs
 *
 * Returns recent sync run history from sync_logs.
 * Query params:
 *   limit  — number of rows to return (default 50, max 200)
 *   page   — 1-based page (default 1)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const limit = Math.min(200, Math.max(1, Number(searchParams.get("limit") ?? "50") || 50));
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  try {
    const [rows, total] = await Promise.all([
      prisma.syncLog.findMany({
        orderBy: { startedAt: "desc" },
        take: limit,
        skip: (page - 1) * limit,
        select: {
          id: true,
          startedAt: true,
          finishedAt: true,
          success: true,
          totalMs: true,
          companyId: true,
          triggeredBy: true,
          steps: true,
          mvResults: true,
          error: true,
        },
      }),
      prisma.syncLog.count(),
    ]);

    return NextResponse.json({
      total,
      page,
      limit,
      rows: rows.map((r) => ({ ...r, id: r.id.toString() })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch sync logs" },
      { status: 500 }
    );
  }
}

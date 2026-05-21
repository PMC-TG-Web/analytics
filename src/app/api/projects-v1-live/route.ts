import { NextResponse } from "next/server";
import { countCanonicalProcoreProjects, fetchCanonicalProcoreProjects } from "@/lib/procoreProjectsCanonical";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const page = Math.max(Number(url.searchParams.get("page") || "1"), 1);
    const pageSize = Math.min(Math.max(Number(url.searchParams.get("pageSize") || "100"), 1), 500);
    const offset = (page - 1) * pageSize;

    const [rows, total] = await Promise.all([
      fetchCanonicalProcoreProjects({ pageSize, offset }),
      countCanonicalProcoreProjects(),
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

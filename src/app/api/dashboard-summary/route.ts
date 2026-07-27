import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  buildEstimatingDashboardSummary,
  loadEstimatingDashboardProjects,
} from "@/lib/estimatingDashboard";

export const dynamic = "force-dynamic";

function buildETag(payload: unknown): string {
  return `W/"${createHash("sha1").update(JSON.stringify(payload)).digest("hex")}"`;
}

function matchesETag(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === "*") return true;
  return header.split(",").map((value) => value.trim()).includes(etag);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const projects = await loadEstimatingDashboardProjects({ force: searchParams.get("force") === "true" });
    const payload = {
      success: true,
      data: buildEstimatingDashboardSummary(projects),
    };
    const etag = buildETag(payload);

    if (matchesETag(request.headers.get("if-none-match"), etag)) {
      const response = new NextResponse(null, { status: 304 });
      response.headers.set("ETag", etag);
      response.headers.set("Cache-Control", "private, max-age=30, must-revalidate");
      return response;
    }

    const response = NextResponse.json(payload);
    response.headers.set("ETag", etag);
    response.headers.set("Cache-Control", "private, max-age=30, must-revalidate");
    return response;
  } catch (error) {
    console.error("Failed to fetch estimating dashboard summary:", error);
    return NextResponse.json(
      { success: false, error: "Failed to fetch estimating dashboard summary" },
      { status: 500 },
    );
  }
}

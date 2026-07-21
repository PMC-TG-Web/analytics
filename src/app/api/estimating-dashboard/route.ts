import { NextResponse } from "next/server";
import {
  loadEstimateLineItems,
  loadEstimatingDashboardProjects,
} from "@/lib/estimatingDashboard";

export const dynamic = "force-dynamic";

function positiveInteger(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const force = searchParams.get("force") === "true";
    const projects = await loadEstimatingDashboardProjects({ force });
    const details = searchParams.get("details") === "true";

    if (details) {
      const bidBoardId = (searchParams.get("bidBoardId") || "").trim();
      const project = projects.find((row) => row.bidBoardId === bidBoardId);
      if (!project) {
        return NextResponse.json({ success: false, error: "Estimating project not found" }, { status: 404 });
      }

      const lineItems = await loadEstimateLineItems(project);
      return NextResponse.json({
        success: true,
        data: [{
          ...project,
          customFields: {
            ...project.customFields,
            lineItems,
          },
        }],
        total: 1,
        page: 1,
        pageSize: 1,
        totalPages: 1,
        hasNextPage: false,
      });
    }

    const customer = (searchParams.get("customer") || "").trim().toLowerCase();
    const projectNumber = (searchParams.get("projectNumber") || "").trim().toLowerCase();
    const projectName = (searchParams.get("projectName") || "").trim().toLowerCase();
    const statuses = new Set(
      (searchParams.get("statuses") || "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );

    const filtered = projects.filter((project) => {
      if (customer && (project.customer || "").trim().toLowerCase() !== customer) return false;
      if (projectNumber && (project.projectNumber || "").trim().toLowerCase() !== projectNumber) return false;
      if (projectName && (project.projectName || "").trim().toLowerCase() !== projectName) return false;
      if (statuses.size > 0 && !statuses.has((project.status || "").trim().toLowerCase())) return false;
      return true;
    });

    const page = positiveInteger(searchParams.get("page"), 1, 1_000_000);
    const pageSize = positiveInteger(searchParams.get("pageSize"), 500, 500);
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;

    const response = NextResponse.json({
      success: true,
      data: filtered.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      totalPages,
      hasNextPage: page < totalPages,
    });
    response.headers.set("Cache-Control", "private, max-age=30, must-revalidate");
    return response;
  } catch (error) {
    console.error("Failed to load estimating dashboard projects:", error);
    return NextResponse.json(
      { success: false, error: "Failed to load estimating dashboard projects" },
      { status: 500 },
    );
  }
}

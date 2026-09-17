import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { procoreConfig } from "@/lib/procore";
import { getCurrentUserEmail } from "@/lib/requestUser";

export const dynamic = "force-dynamic";

// Inherits procore-commitments permission; signed project links do not authorize
// this collection. Return only the selector fields from the maker's project mirror.
export async function GET() {
  if (!await getCurrentUserEmail()) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  try {
    const projects = await prisma.pmcProject.findMany({
      where: { companyId: procoreConfig.companyId },
      select: { procoreProjectId: true, projectNumber: true, projectName: true, status: true },
      orderBy: [{ projectNumber: "asc" }, { projectName: "asc" }],
    });
    return NextResponse.json(projects.map((project) => ({
      id: project.procoreProjectId,
      number: project.projectNumber || "",
      name: project.projectName,
      status: project.status || "",
    })), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Projects could not be loaded." }, { status: 500 });
  }
}

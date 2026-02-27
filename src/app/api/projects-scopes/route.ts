import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const [projects, scopes] = await Promise.all([
      prisma.project.findMany(),
      prisma.projectScope.findMany(),
    ]);

    return NextResponse.json({
      projects,
      scopes,
    });
  } catch (error) {
    console.error("Failed to fetch projects and scopes:", error);
    return NextResponse.json(
      { error: "Failed to fetch data" },
      { status: 500 }
    );
  }
}

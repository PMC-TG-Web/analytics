import { NextRequest, NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = String(searchParams.get("id") || "").trim();
    const source = String(searchParams.get("source") || "").trim();

    if (!id) {
      return NextResponse.json({ error: "Missing id query param" }, { status: 400 });
    }

    const whereSource = source ? `AND source = '${source.replace(/'/g, "''")}'` : "";
    const rows = await prisma.$queryRawUnsafe(
      `
      SELECT *
      FROM procore_project_staging
      WHERE external_id = $1 OR procore_project_id = $1
      ${whereSource}
      ORDER BY synced_at DESC
      LIMIT 20
      `,
      id
    );

    return NextResponse.json({
      success: true,
      id,
      count: Array.isArray(rows) ? rows.length : 0,
      rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

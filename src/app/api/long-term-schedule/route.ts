import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const jobKey = request.nextUrl.searchParams.get("jobKey");
    const month = request.nextUrl.searchParams.get("month");

    let whereClause: any = {};
    if (jobKey) whereClause.jobKey = jobKey;
    if (month) whereClause.month = month;

    const schedules = await prisma.schedule.findMany({
      where: Object.keys(whereClause).length > 0 ? whereClause : undefined,
    });

    return NextResponse.json(schedules);
  } catch (error) {
    console.error("Failed to fetch long-term schedules:", error);
    return NextResponse.json(
      { error: "Failed to fetch schedules" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { jobKey, month, weeks, totalHours } = body;

    if (!jobKey || !month || !weeks) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const docId = `${jobKey}_${month}`.replace(/[^a-zA-Z0-9_-]/g, "_");

    const schedule = await prisma.schedule.upsert({
      where: {
        id: docId,
      },
      update: {
        weeks,
        totalHours,
        updatedAt: new Date(),
      },
      create: {
        id: docId,
        jobKey,
        month,
        weeks,
        totalHours,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    return NextResponse.json(schedule);
  } catch (error) {
    console.error("Failed to save long-term schedule:", error);
    return NextResponse.json(
      { error: "Failed to save schedule" },
      { status: 500 }
    );
  }
}

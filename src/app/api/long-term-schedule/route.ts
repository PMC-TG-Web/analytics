import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const jobKey = request.nextUrl.searchParams.get("jobKey");
    const month = request.nextUrl.searchParams.get("month");

    let whereClause: any = {};
    if (jobKey) whereClause.jobKey = jobKey;

    const schedules = await prisma.schedule.findMany({
      where: Object.keys(whereClause).length > 0 ? whereClause : undefined,
    });

    // If filtering by month, filter in memory from the longTermData JSON
    if (month) {
      return NextResponse.json(
        schedules.filter((schedule) => {
          if (!schedule.longTermData || typeof schedule.longTermData !== 'object') return false;
          const longTermData = schedule.longTermData as any;
          return longTermData[month] !== undefined;
        })
      );
    }

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

    // Find or create schedule by jobKey
    const schedule = await prisma.schedule.upsert({
      where: {
        jobKey: jobKey,
      },
      update: {
        // Store monthly data in longTermData JSON field
        longTermData: {
          [month]: weeks,
        },
        totalHours: (totalHours || 0) + (weeks?.reduce?.((sum: number, week: any) => sum + (week.hours || 0), 0) || 0),
        updatedAt: new Date(),
      },
      create: {
        jobKey: jobKey,
        // Store monthly data in longTermData JSON field
        longTermData: {
          [month]: weeks,
        },
        totalHours: totalHours || (weeks?.reduce?.((sum: number, week: any) => sum + (week.hours || 0), 0) || 0),
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

import { prisma } from '@/lib/prisma';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const summary = await prisma.dashboardSummary.findUnique({
      where: { id: 'summary' },
    });

    if (!summary) {
      return NextResponse.json({
        success: true,
        data: null,
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        totalSales: summary.totalSales,
        totalCost: summary.totalCost,
        totalHours: summary.totalHours,
        statusGroups: summary.statusGroups,
        contractors: summary.contractors,
        pmcGroupHours: summary.pmcGroupHours,
        laborBreakdown: summary.laborBreakdown,
        lastUpdated: summary.lastUpdated,
      },
    });
  } catch (error) {
    console.error('Failed to fetch dashboard summary:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch dashboard summary' },
      { status: 500 }
    );
  }
}

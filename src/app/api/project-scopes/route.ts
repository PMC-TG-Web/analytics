import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const scopes = await prisma.projectScope.findMany({
      select: {
        id: true,
        jobKey: true,
        scopeOfWork: true,
        startDate: true,
        endDate: true,
        hours: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: scopes,
    });
  } catch (error) {
    console.error('Failed to fetch scopes:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch scopes' },
      { status: 500 }
    );
  }
}

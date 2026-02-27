import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    // Get all projects with status not in ["Bid Submitted", "Lost"]
    const projects = await prisma.project.findMany({
      where: {
        status: {
          notIn: ['Bid Submitted', 'Lost'],
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: projects,
    });
  } catch (error) {
    console.error('Failed to fetch projects:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch projects' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { status } = body;

    if (!status) {
      return NextResponse.json(
        { success: false, error: 'Status is required' },
        { status: 400 }
      );
    }

    // Update project status
    const updated = await prisma.project.updateMany({
      where: {
        customer: body.customer,
        projectNumber: body.projectNumber,
      },
      data: {
        status,
      },
    });

    return NextResponse.json({
      success: true,
      message: `Updated ${updated.count} project(s)`,
      data: { count: updated.count },
    });
  } catch (error) {
    console.error('Failed to update project status:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update status' },
      { status: 500 }
    );
  }
}

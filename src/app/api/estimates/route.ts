import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const type = searchParams.get('type');

    const where: Record<string, string> = {};
    if (projectId) where.projectId = projectId;
    if (type) where.type = type;

    const estimates = await prisma.estimate.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      data: estimates,
    });
  } catch (error) {
    console.error('Failed to fetch estimates:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch estimates' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      projectId,
      projectName,
      customer,
      label,
      type,
      inputs,
      result,
      summary,
      totalCY,
      totalTons,
    } = body;

    if (!label) {
      return NextResponse.json(
        { success: false, error: 'label is required' },
        { status: 400 }
      );
    }

    // Store calculation data as JSON in description since new columns may not exist yet
    const calculationData = {
      projectName,
      customer,
      label,
      type,
      inputs,
      result,
      summary,
      totalCY,
      totalTons,
      timestamp: new Date().toISOString(),
    };

    const estimate = await prisma.estimate.create({
      data: {
        projectId: projectId || undefined,
        title: label,
        description: JSON.stringify(calculationData),
        status: 'Draft',
      },
    });

    return NextResponse.json({
      success: true,
      data: estimate,
    });
  } catch (error) {
    console.error('Failed to create estimate:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create estimate' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status, description, estimatedHours, estimatedCost } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const estimate = await prisma.estimate.update({
      where: { id },
      data: {
        ...(status !== undefined && { status }),
        ...(description !== undefined && { description }),
        ...(estimatedHours !== undefined && { estimatedHours }),
        ...(estimatedCost !== undefined && { estimatedCost }),
      },
    });

    return NextResponse.json({
      success: true,
      data: estimate,
    });
  } catch (error) {
    console.error('Failed to update estimate:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update estimate' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    await prisma.estimate.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('Failed to delete estimate:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete estimate' },
      { status: 500 }
    );
  }
}

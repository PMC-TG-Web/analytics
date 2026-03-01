import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const employeeId = searchParams.get('employeeId');
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const requestedPageSize = Number.parseInt(searchParams.get('pageSize') || '100', 10) || 100;
    const pageSize = Math.min(500, Math.max(1, requestedPageSize));
    const skip = (page - 1) * pageSize;

    const where = employeeId ? { employeeId } : undefined;

    const [total, certifications] = await Promise.all([
      prisma.certification.count({ where }),
      prisma.certification.findMany({
        where,
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { expirationDate: 'asc' },
        skip,
        take: pageSize,
      }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json({
      success: true,
      count: certifications.length,
      total,
      page,
      pageSize,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      data: certifications,
    });
  } catch (error) {
    console.error('Failed to fetch certifications:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch certifications' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { employeeId, type, issueDate, expirationDate, notes } = body;

    if (!employeeId || !type) {
      return NextResponse.json(
        { success: false, error: 'employeeId and type are required' },
        { status: 400 }
      );
    }

    const certification = await prisma.certification.create({
      data: {
        employeeId,
        type,
        issueDate: issueDate || '',
        expirationDate: expirationDate || '',
        notes: notes || null,
      },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return NextResponse.json({
      success: true,
      data: certification,
    });
  } catch (error) {
    console.error('Failed to create certification:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create certification' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    await prisma.certification.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('Failed to delete certification:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete certification' },
      { status: 500 }
    );
  }
}

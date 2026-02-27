import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const employeeId = searchParams.get('employeeId');

    const certifications = await prisma.certification.findMany({
      where: employeeId ? { employeeId } : undefined,
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { expirationDate: 'asc' },
    });

    return NextResponse.json({
      success: true,
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

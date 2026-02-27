import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const holidays = await prisma.holiday.findMany({
      orderBy: {
        date: 'asc',
      },
      select: {
        id: true,
        name: true,
        date: true,
        isPaid: true,
        description: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: holidays,
    });
  } catch (error) {
    console.error('Failed to fetch holidays:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch holidays' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Handle batch creation (for seed/import)
    if (Array.isArray(body)) {
      const holidays = await prisma.holiday.createMany({
        data: body.map((h) => ({
          name: h.name,
          date: h.date,
          isPaid: h.isPaid ?? true,
          description: h.description || null,
        })),
        skipDuplicates: true,
      });

      return NextResponse.json({
        success: true,
        data: holidays,
      });
    }

    // Handle single creation
    const { name, date, isPaid, description } = body;

    if (!name || !date) {
      return NextResponse.json(
        { success: false, error: 'name and date are required' },
        { status: 400 }
      );
    }

    const holiday = await prisma.holiday.create({
      data: {
        name,
        date,
        isPaid: isPaid ?? true,
        description: description || null,
      },
    });

    return NextResponse.json({
      success: true,
      data: holiday,
    });
  } catch (error) {
    console.error('Failed to create holiday:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create holiday' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, date, isPaid, description } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const holiday = await prisma.holiday.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(date !== undefined && { date }),
        ...(isPaid !== undefined && { isPaid }),
        ...(description !== undefined && { description: description || null }),
      },
    });

    return NextResponse.json({
      success: true,
      data: holiday,
    });
  } catch (error) {
    console.error('Failed to update holiday:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update holiday' },
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

    await prisma.holiday.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('Failed to delete holiday:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete holiday' },
      { status: 500 }
    );
  }
}

import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const type = searchParams.get('type');

    const equipment = await prisma.equipment.findMany({
      where: type ? { type } : undefined,
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({
      success: true,
      data: equipment,
    });
  } catch (error) {
    console.error('Failed to fetch equipment:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch equipment' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, type, make, model, serialNumber, status, hourlyRate, dailyRate, notes, isActive } = body;

    if (!name || !type) {
      return NextResponse.json(
        { success: false, error: 'name and type are required' },
        { status: 400 }
      );
    }

    const equipment = await prisma.equipment.create({
      data: {
        name,
        type,
        make: make || null,
        model: model || null,
        serialNumber: serialNumber || null,
        status: status || 'Available',
        hourlyRate: hourlyRate || null,
        dailyRate: dailyRate || null,
        notes: notes || null,
        isActive: isActive ?? true,
      },
    });

    return NextResponse.json({
      success: true,
      data: equipment,
    });
  } catch (error) {
    console.error('Failed to create equipment:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create equipment' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, type, make, model, serialNumber, status, hourlyRate, dailyRate, notes, isActive } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const equipment = await prisma.equipment.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(make !== undefined && { make: make || null }),
        ...(model !== undefined && { model: model || null }),
        ...(serialNumber !== undefined && { serialNumber: serialNumber || null }),
        ...(status !== undefined && { status }),
        ...(hourlyRate !== undefined && { hourlyRate: hourlyRate || null }),
        ...(dailyRate !== undefined && { dailyRate: dailyRate || null }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return NextResponse.json({
      success: true,
      data: equipment,
    });
  } catch (error) {
    console.error('Failed to update equipment:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update equipment' },
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

    await prisma.equipment.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('Failed to delete equipment:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete equipment' },
      { status: 500 }
    );
  }
}

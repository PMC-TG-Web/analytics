import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const category = searchParams.get('category');

    const constants = await prisma.estimatingConstant.findMany({
      where: category ? { category } : undefined,
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({
      success: true,
      data: constants,
    });
  } catch (error) {
    console.error('Failed to fetch constants:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch constants' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, value, category } = body;

    if (!name || !value) {
      return NextResponse.json(
        { success: false, error: 'name and value are required' },
        { status: 400 }
      );
    }

    const constant = await prisma.estimatingConstant.create({
      data: {
        name,
        value,
        category: category || 'General',
      },
    });

    return NextResponse.json({
      success: true,
      data: constant,
    });
  } catch (error) {
    console.error('Failed to create constant:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create constant' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, value, category } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const constant = await prisma.estimatingConstant.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(value !== undefined && { value }),
        ...(category !== undefined && { category }),
      },
    });

    return NextResponse.json({
      success: true,
      data: constant,
    });
  } catch (error) {
    console.error('Failed to update constant:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update constant' },
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

    await prisma.estimatingConstant.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('Failed to delete constant:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete constant' },
      { status: 500 }
    );
  }
}

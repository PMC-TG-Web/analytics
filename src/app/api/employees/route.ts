import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const isActive = searchParams.get('isActive');
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const requestedPageSize = Number.parseInt(searchParams.get('pageSize') || '100', 10) || 100;
    const pageSize = Math.min(500, Math.max(1, requestedPageSize));
    const skip = (page - 1) * pageSize;

    const where = isActive !== null ? { isActive: isActive === 'true' } : undefined;

    const [total, employees] = await Promise.all([
      prisma.employee.count({ where }),
      prisma.employee.findMany({
        where,
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        skip,
        take: pageSize,
      }),
    ]);

    // Unpack customFields to top-level properties for UI compatibility
    const formattedEmployees = employees.map(emp => {
      const custom = (emp.customFields ?? {}) as Record<string, unknown>;
      return {
        id: emp.id,
        firstName: emp.firstName,
        lastName: emp.lastName,
        jobTitle: emp.jobTitle,
        email: emp.email,
        phone: emp.phone,
        isActive: emp.isActive,
        createdAt: emp.createdAt.toISOString(),
        updatedAt: emp.updatedAt.toISOString(),
        // Unpack custom fields
        workEmail: custom.workEmail || custom.WorkEmail,
        workPhone: custom.workPhone || custom.WorkPhone,
        employeePhone: custom.employeePhone || custom.EmployeePhone,
        personalEmail: custom.otherEmail || custom.Other_Email,
        address: custom.address || custom.Address,
        city: custom.city || custom.City,
        state: custom.state || custom.State,
        zip: custom.zip || custom.Zip,
        country: custom.country || custom.Country,
        hourlyRate: custom.hourlyRate,
        vacationHours: custom.vacationHours,
        keypadCode: custom.keypadCode,
        dateOfBirth: custom.dateOfBirth,
        hireDate: custom.hireDate,
        dateOfLeave: custom.dateOfLeave,
        payHistory: custom.payHistory,
        apparelRecords: custom.apparelRecords,
        notes: custom.notes,
      };
    });

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json({
      success: true,
      count: formattedEmployees.length,
      total,
      page,
      pageSize,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      data: formattedEmployees,
    });
  } catch (error) {
    console.error('Failed to fetch employees:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch employees' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { firstName, lastName, jobTitle, email, phone, isActive, customFields } = body;

    if (!firstName || !lastName) {
      return NextResponse.json(
        { success: false, error: 'firstName and lastName are required' },
        { status: 400 }
      );
    }

    const employee = await prisma.employee.create({
      data: {
        firstName,
        lastName,
        jobTitle: jobTitle || null,
        email: email || null,
        phone: phone || null,
        isActive: isActive ?? true,
        customFields: customFields || null,
      },
    });

    return NextResponse.json({
      success: true,
      data: employee,
    });
  } catch (error) {
    console.error('Failed to create employee:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create employee' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, firstName, lastName, jobTitle, email, phone, isActive, customFields } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const employee = await prisma.employee.update({
      where: { id },
      data: {
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName }),
        ...(jobTitle !== undefined && { jobTitle: jobTitle || null }),
        ...(email !== undefined && { email: email || null }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(isActive !== undefined && { isActive }),
        ...(customFields !== undefined && { customFields: customFields || null }),
      },
    });

    return NextResponse.json({
      success: true,
      data: employee,
    });
  } catch (error) {
    console.error('Failed to update employee:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update employee' },
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

    await prisma.employee.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error('Failed to delete employee:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete employee' },
      { status: 500 }
    );
  }
}

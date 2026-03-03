import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const includeInactive = searchParams.get('includeInactive') === 'true';

    const where = includeInactive ? {} : { isActive: true };

    const employees = await prisma.employee.findMany({
      where,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });

    return generateCSV(employees);
  } catch (error) {
    console.error('Failed to export employees:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to export employees' },
      { status: 500 }
    );
  }
}

function generateCSV(employees: any[]) {
  // Define CSV headers
  const headers = [
    'First Name',
    'Last Name',
    'Job Title',
    'Email',
    'Phone',
    'Work Phone',
    'Employee Phone',
    'Address',
    'City',
    'State',
    'Zip',
    'Country',
    'Hourly Rate',
    'Vacation Hours',
    'Keypad Code',
    'Date of Birth',
    'Hire Date',
    'Date of Leave',
    'Status',
    'Notes',
  ];

  // Generate CSV rows
  const rows = employees.map((emp) => {
    const custom = (emp.customFields as any) || {};
    
    return [
      emp.firstName,
      emp.lastName,
      emp.jobTitle || '',
      emp.email || '',
      emp.phone || '',
      custom.workPhone || '',
      custom.employeePhone || '',
      custom.address || '',
      custom.city || '',
      custom.state || '',
      custom.zip || '',
      custom.country || '',
      custom.hourlyRate || '',
      custom.vacationHours || '',
      custom.keypadCode || '',
      custom.dateOfBirth || '',
      custom.hireDate || '',
      custom.dateOfLeave || '',
      emp.isActive ? 'Active' : 'Inactive',
      custom.notes || '',
    ].map((value) => {
      // Escape quotes and wrap in quotes if contains comma, quote, or newline
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    }).join(',');
  });

  // Combine headers and rows
  const csv = [headers.join(','), ...rows].join('\n');

  // Generate filename with timestamp
  const timestamp = new Date().toISOString().split('T')[0];
  const filename = `employees_${timestamp}.csv`;

  // Return CSV file
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

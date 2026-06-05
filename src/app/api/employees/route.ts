import { prisma } from '@/lib/prisma';
import { getErrorMessage, shouldFallbackToEmptyRead } from '@/lib/dbResilience';
import {
  buildJobTitleTemplateConstantName,
  getTemplatePermissionsForJobTitle,
  normalizeJobTitleTemplateKey,
} from '@/lib/permissions';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function normalizeNavigationPermissions(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((permission): permission is string => typeof permission === 'string')
    .map((permission) => permission.trim())
    .filter((permission) => permission.length > 0);
}

function getNavigationPermissionsFromBody(body: Record<string, unknown>): string[] | null {
  if (Object.prototype.hasOwnProperty.call(body, 'navigationPermissions')) {
    return normalizeNavigationPermissions(body.navigationPermissions);
  }

  const customFields = body.customFields;
  if (!customFields || typeof customFields !== 'object') return null;

  const custom = customFields as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(custom, 'navigationPermissions')) {
    return normalizeNavigationPermissions(custom.navigationPermissions);
  }

  if (Object.prototype.hasOwnProperty.call(custom, 'NavigationPermissions')) {
    return normalizeNavigationPermissions(custom.NavigationPermissions);
  }

  return null;
}

async function syncUserPermissions(email: string | null | undefined, permissions: string[], isActive: boolean): Promise<void> {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalizedEmail) return;

  await prisma.user.upsert({
    where: { email: normalizedEmail },
    create: {
      email: normalizedEmail,
      permissions,
      isActive,
    },
    update: {
      permissions,
      isActive,
    },
  });
}

async function resolveTemplatePermissionsForJobTitle(
  jobTitle: string | null | undefined
): Promise<{ permissions: string[]; hasCustomTemplate: boolean }> {
  const normalizedTitle = normalizeJobTitleTemplateKey(jobTitle);
  if (!normalizedTitle) return { permissions: [], hasCustomTemplate: false };

  const constantName = buildJobTitleTemplateConstantName(normalizedTitle);
  const customTemplate = await prisma.estimatingConstant.findUnique({
    where: { name: constantName },
    select: { value: true },
  });

  if (customTemplate?.value) {
    try {
      const parsed = JSON.parse(customTemplate.value) as unknown;

      if (Array.isArray(parsed)) {
        return {
          permissions: normalizeNavigationPermissions(parsed),
          hasCustomTemplate: true,
        };
      }

      if (parsed && typeof parsed === 'object') {
        const rec = parsed as Record<string, unknown>;
        return {
          permissions: normalizeNavigationPermissions(rec.permissions),
          hasCustomTemplate: true,
        };
      }
    } catch {
      // Ignore malformed template JSON and fall through to static defaults.
    }
  }

  return {
    permissions: getTemplatePermissionsForJobTitle(normalizedTitle),
    hasCustomTemplate: false,
  };
}

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

    const employeeEmails = employees
      .map((employee) => employee.email?.trim().toLowerCase())
      .filter((email): email is string => Boolean(email));

    const users = employeeEmails.length > 0
      ? await prisma.user.findMany({
          where: { email: { in: employeeEmails } },
          select: { email: true, permissions: true },
        })
      : [];

    const userPermissionsByEmail = new Map<string, string[]>();
    for (const user of users) {
      userPermissionsByEmail.set(user.email.toLowerCase(), normalizeNavigationPermissions(user.permissions));
    }

    // Unpack customFields to top-level properties for UI compatibility
    const formattedEmployees = employees.map(emp => {
      const custom = (emp.customFields ?? {}) as Record<string, unknown>;
      const fullName = `${emp.firstName || ''} ${emp.lastName || ''}`.replace(/\s+/g, ' ').trim();
      const normalizedEmail = emp.email?.trim().toLowerCase() || '';
      const customNavigationPermissions = normalizeNavigationPermissions(
        custom.navigationPermissions ?? custom.NavigationPermissions
      );
      const effectiveNavigationPermissions = customNavigationPermissions.length > 0
        ? customNavigationPermissions
        : (normalizedEmail ? userPermissionsByEmail.get(normalizedEmail) || [] : []);

      return {
        id: emp.id,
        firstName: emp.firstName,
        lastName: emp.lastName,
        fullName,
        title: emp.jobTitle,
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
        navigationPermissions: effectiveNavigationPermissions,
      };
    });

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    return NextResponse.json(
      {
        success: true,
        count: formattedEmployees.length,
        total,
        page,
        pageSize,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
        data: formattedEmployees,
      },
      { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } }
    );
  } catch (error) {
    console.error('Failed to fetch employees:', error);
    if (shouldFallbackToEmptyRead(error)) {
      const fallbackPage = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get('page') || '1', 10) || 1);
      const requestedPageSize = Number.parseInt(request.nextUrl.searchParams.get('pageSize') || '100', 10) || 100;
      const fallbackPageSize = Math.min(500, Math.max(1, requestedPageSize));

      return NextResponse.json({
        success: true,
        count: 0,
        total: 0,
        page: fallbackPage,
        pageSize: fallbackPageSize,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: fallbackPage > 1,
        data: [],
      });
    }

    return NextResponse.json(
      { success: false, error: `Failed to fetch employees: ${getErrorMessage(error)}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { firstName, lastName, jobTitle, email, phone, isActive, customFields } = body;
    const navigationPermissions = getNavigationPermissionsFromBody(body as Record<string, unknown>);
    const templateResolution = await resolveTemplatePermissionsForJobTitle(
      typeof jobTitle === 'string' ? jobTitle : null
    );

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

    const effectivePermissions = navigationPermissions ?? templateResolution.permissions;
    if (navigationPermissions !== null || templateResolution.hasCustomTemplate || templateResolution.permissions.length > 0) {
      await syncUserPermissions(employee.email, effectivePermissions, employee.isActive);
    }

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
    const navigationPermissions = getNavigationPermissionsFromBody(body as Record<string, unknown>);

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const previousEmployee = await prisma.employee.findUnique({
      where: { id },
      select: { email: true },
    });

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

    const previousEmail = typeof previousEmployee?.email === 'string'
      ? previousEmployee.email.trim().toLowerCase()
      : '';
    const currentEmail = typeof employee.email === 'string'
      ? employee.email.trim().toLowerCase()
      : '';

    if (previousEmail && previousEmail !== currentEmail) {
      await prisma.user.updateMany({
        where: { email: previousEmail },
        data: { isActive: false },
      });
    }

    const templateResolution = await resolveTemplatePermissionsForJobTitle(
      typeof employee.jobTitle === 'string' ? employee.jobTitle : null
    );
    const effectivePermissions = navigationPermissions ?? templateResolution.permissions;
    if (navigationPermissions !== null || templateResolution.hasCustomTemplate || templateResolution.permissions.length > 0) {
      await syncUserPermissions(
        employee.email,
        effectivePermissions,
        employee.isActive
      );
    }

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

    const employee = await prisma.employee.delete({
      where: { id },
    });

    const normalizedEmail = typeof employee.email === 'string' ? employee.email.trim().toLowerCase() : '';
    if (normalizedEmail) {
      await prisma.user.updateMany({
        where: { email: normalizedEmail },
        data: { isActive: false },
      });
    }

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

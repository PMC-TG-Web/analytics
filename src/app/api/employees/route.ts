import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { getErrorMessage, shouldFallbackToEmptyRead } from '@/lib/dbResilience';
import { getAccessManagementActor } from '@/lib/accessManagement';
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

async function syncUserPermissions(tx: Prisma.TransactionClient, email: string | null | undefined, permissions: string[], isActive: boolean): Promise<void> {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalizedEmail) return;

  await tx.user.upsert({
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

const normalizedEmail = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const accessDenied = () => NextResponse.json(
  { success: false, error: 'An administrator must change application permissions, a linked sign-in email, or a linked account’s status.' },
  { status: 403 }
);
function employeeMutationDenied(actor: Awaited<ReturnType<typeof getAccessManagementActor>>) {
  if (!actor.email) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (!actor.canEditEmployees) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  return null;
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
          where: { email: { in: employeeEmails, mode: 'insensitive' } },
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
      // Employee custom fields are historical profile metadata, not authority
      // for current access. Never replay a stale grant into an administrator form.
      const effectiveNavigationPermissions = normalizedEmail ? userPermissionsByEmail.get(normalizedEmail) || [] : [];

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
        hasLoginAccount: !!normalizedEmail && userPermissionsByEmail.has(normalizedEmail),
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
    const actor = await getAccessManagementActor(request);
    const denied = employeeMutationDenied(actor);
    if (denied) return denied;
    const body = await request.json();
    const { firstName, lastName, jobTitle, email, phone, isActive, customFields } = body;
    const navigationPermissions = getNavigationPermissionsFromBody(body as Record<string, unknown>);
    if (navigationPermissions !== null && !actor.canManageAccess) return accessDenied();

    if (!firstName || !lastName) {
      return NextResponse.json(
        { success: false, error: 'firstName and lastName are required' },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async tx => {
      const currentEmail = normalizedEmail(email);
      const linkedUser = currentEmail ? await tx.user.findFirst({
        where: { email: { equals: currentEmail, mode: 'insensitive' } }, select: { id: true },
      }) : null;
      if (linkedUser && !actor.canManageAccess) return { denied: true as const };
      const created = await tx.employee.create({
        data: {
          firstName,
          lastName,
          jobTitle: jobTitle || null,
          email: currentEmail || null,
          phone: phone || null,
          isActive: isActive ?? true,
          customFields: customFields || null,
        },
      });
      if (navigationPermissions !== null) await syncUserPermissions(tx, created.email, navigationPermissions, created.isActive);
      const account = created.email ? await tx.user.findFirst({ where: { email: { equals: created.email, mode: 'insensitive' } }, select: { permissions: true } }) : null;
      return { employee: { ...created, hasLoginAccount: !!account, navigationPermissions: normalizeNavigationPermissions(account?.permissions) } };
    }, { isolationLevel: 'Serializable' });
    if ('denied' in result) return accessDenied();

    return NextResponse.json({
      success: true,
      data: result.employee,
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
    const actor = await getAccessManagementActor(request);
    const denied = employeeMutationDenied(actor);
    if (denied) return denied;
    const body = await request.json();
    const { id, firstName, lastName, jobTitle, email, phone, isActive, customFields } = body;
    const navigationPermissions = getNavigationPermissionsFromBody(body as Record<string, unknown>);
    if (navigationPermissions !== null && !actor.canManageAccess) return accessDenied();

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async tx => {
      const previousEmployee = await tx.employee.findUnique({
        where: { id },
        select: { email: true, isActive: true },
      });
      if (!previousEmployee) return { missing: true as const };
      const previousEmail = normalizedEmail(previousEmployee.email);
      const currentEmail = email === undefined ? previousEmail : normalizedEmail(email);
      const linkedUser = previousEmail ? await tx.user.findFirst({
        where: { email: { equals: previousEmail, mode: 'insensitive' } }, select: { id: true },
      }) : null;
      // Linking a different existing login must be checked as well as unlinking one.
      const newLinkedUser = currentEmail && currentEmail !== previousEmail ? await tx.user.findFirst({
        where: { email: { equals: currentEmail, mode: 'insensitive' } }, select: { id: true },
      }) : null;
      const changesLogin = previousEmail !== currentEmail || (isActive !== undefined && isActive !== previousEmployee.isActive);
      if (!actor.canManageAccess && changesLogin && (linkedUser || newLinkedUser)) return { denied: true as const };

      const employee = await tx.employee.update({
        where: { id },
        data: {
          ...(firstName !== undefined && { firstName }),
          ...(lastName !== undefined && { lastName }),
          ...(jobTitle !== undefined && { jobTitle: jobTitle || null }),
          ...(email !== undefined && { email: currentEmail || null }),
          ...(phone !== undefined && { phone: phone || null }),
          ...(isActive !== undefined && { isActive }),
          ...(customFields !== undefined && { customFields: customFields || null }),
        },
      });

      if (actor.canManageAccess && previousEmail && previousEmail !== currentEmail) {
        await tx.user.updateMany({
          where: { email: { equals: previousEmail, mode: 'insensitive' } },
          data: { isActive: false },
        });
      }

      if (navigationPermissions !== null) {
        await syncUserPermissions(tx, employee.email, navigationPermissions, employee.isActive);
      } else if (actor.canManageAccess && isActive !== undefined && isActive !== previousEmployee.isActive && currentEmail) {
        await tx.user.updateMany({ where: { email: { equals: currentEmail, mode: 'insensitive' } }, data: { isActive: employee.isActive } });
      }
      const account = currentEmail ? await tx.user.findFirst({ where: { email: { equals: currentEmail, mode: 'insensitive' } }, select: { permissions: true } }) : null;
      return { employee: { ...employee, hasLoginAccount: !!account, navigationPermissions: normalizeNavigationPermissions(account?.permissions) } };
    }, { isolationLevel: 'Serializable' });
    if ('denied' in result) return accessDenied();
    if ('missing' in result) return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 });

    return NextResponse.json({
      success: true,
      data: result.employee,
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
    const actor = await getAccessManagementActor(request);
    const denied = employeeMutationDenied(actor);
    if (denied) return denied;
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'id is required' },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async tx => {
      const employee = await tx.employee.findUnique({ where: { id }, select: { email: true } });
      if (!employee) return { missing: true as const };
      const email = normalizedEmail(employee.email);
      const linkedUser = email ? await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } }) : null;
      if (linkedUser && !actor.canManageAccess) return { denied: true as const };
      await tx.employee.delete({ where: { id } });
      if (actor.canManageAccess && email) await tx.user.updateMany({
        where: { email: { equals: email, mode: 'insensitive' } },
        data: { isActive: false },
      });
      return {};
    }, { isolationLevel: 'Serializable' });
    if ('denied' in result) return accessDenied();
    if ('missing' in result) return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 });

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

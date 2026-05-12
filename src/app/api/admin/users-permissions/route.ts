import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRequestUserEmail } from '@/lib/requestUser';
import { loadUserAssignedPermissionsFromDatabase } from '@/lib/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type UserPermissionRecord = {
  id: string;
  email: string;
  permissions: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function isAdminPermission(permissions: string[]) {
  return permissions.includes('OWNER') || permissions.includes('ADMIN');
}

async function requireAdmin(request: NextRequest) {
  const email = await getRequestUserEmail(request);
  if (!email) {
    return { authorized: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const permissions = await loadUserAssignedPermissionsFromDatabase(prisma, email);
  if (!isAdminPermission(permissions)) {
    return { authorized: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }

  return { authorized: true as const, email };
}

function normalizePermissions(permissions: unknown): string[] {
  if (!Array.isArray(permissions)) return [];
  return permissions.filter((permission): permission is string => {
    return typeof permission === 'string' && permission.trim().length > 0;
  });
}

// POST - Add or update a user's permissions
export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin.authorized) return admin.response;

    const { email, permissions } = await request.json();
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedPermissions = normalizePermissions(permissions);
    
    if (!normalizedEmail || !Array.isArray(permissions)) {
      return NextResponse.json(
        { error: 'Invalid request: email and permissions array required' },
        { status: 400 }
      );
    }

    const rows = await prisma.$queryRaw<UserPermissionRecord[]>`
      INSERT INTO "User" ("id", "email", "permissions", "isActive", "createdAt", "updatedAt")
      VALUES (${randomUUID()}, ${normalizedEmail}, ${normalizedPermissions}, true, NOW(), NOW())
      ON CONFLICT ("email")
      DO UPDATE SET
        "permissions" = EXCLUDED."permissions",
        "isActive" = true,
        "updatedAt" = NOW()
      RETURNING "id", "email", "permissions", "isActive", "createdAt", "updatedAt"
    `;

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error updating user permissions:', error);
    return NextResponse.json(
      { error: 'Failed to update permissions' },
      { status: 500 }
    );
  }
}

// GET - Get a specific user's permissions
export async function GET(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin.authorized) return admin.response;

    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email')?.trim().toLowerCase();

    if (!email) {
      return NextResponse.json(
        { error: 'Email parameter required' },
        { status: 400 }
      );
    }

    const rows = await prisma.$queryRaw<Pick<UserPermissionRecord, 'email' | 'permissions' | 'isActive'>[]>`
      SELECT "email", "permissions", "isActive"
      FROM "User"
      WHERE lower("email") = ${email}
      LIMIT 1
    `;

    if (!rows[0]) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ data: rows[0] });
  } catch (error) {
    console.error('Error fetching user permissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch permissions' },
      { status: 500 }
    );
  }
}

// DELETE - Deactivate a user (set isActive to false)
export async function DELETE(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin.authorized) return admin.response;

    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email')?.trim().toLowerCase();

    if (!email) {
      return NextResponse.json(
        { error: 'Email parameter required' },
        { status: 400 }
      );
    }

    const rows = await prisma.$queryRaw<UserPermissionRecord[]>`
      UPDATE "User"
      SET "isActive" = false,
          "updatedAt" = NOW()
      WHERE lower("email") = ${email}
      RETURNING "id", "email", "permissions", "isActive", "createdAt", "updatedAt"
    `;

    if (!rows[0]) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('Error deactivating user:', error);
    return NextResponse.json(
      { error: 'Failed to deactivate user' },
      { status: 500 }
    );
  }
}

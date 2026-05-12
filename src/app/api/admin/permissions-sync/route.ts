import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRequestUserEmail } from '@/lib/requestUser';
import { loadUserAssignedPermissionsFromDatabase } from '@/lib/permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function isAdminPermission(permissions: string[]) {
  return permissions.includes('OWNER') || permissions.includes('ADMIN');
}

// GET - Get all current permissions (admin only)
export async function GET(request: NextRequest) {
  try {
    const email = await getRequestUserEmail(request);
    if (!email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const currentUserPermissions = await loadUserAssignedPermissionsFromDatabase(prisma, email);
    if (!isAdminPermission(currentUserPermissions)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Use raw SQL because permissions are stored as a Postgres text array.
    const users = await prisma.$queryRaw<{ email: string; permissions: string[] }[]>`
      SELECT "email", "permissions"
      FROM "User"
      WHERE "isActive" = true
      ORDER BY "email" ASC
    `;

    return NextResponse.json({ 
      success: true,
      data: users 
    });
  } catch (error) {
    console.error('Error fetching permissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch permissions', detail: String(error) },
      { status: 500 }
    );
  }
}

// POST - same as GET, for compat
export async function POST(request: NextRequest) {
  return GET(request);
}

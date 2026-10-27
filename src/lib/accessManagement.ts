import { NextRequest, NextResponse } from 'next/server';
import { prisma } from './prisma';
import { getRequestUserEmail } from './requestUser';
import { expandAssignedPermissions, loadUserAssignedPermissionsFromDatabase, hasAccessAdministratorRole } from './permissions';

// Access management uses current, active database assignments, never the cached
// navigation cookie or a job-title template. Match the existing administrator API.
export async function getAccessManagementActor(request: NextRequest) {
  const email = await getRequestUserEmail(request);
  const permissions = email ? await loadUserAssignedPermissionsFromDatabase(prisma, email) : [];
  return {
    email,
    permissions,
    canManageAccess: hasAccessAdministratorRole(permissions),
    canEditEmployees: expandAssignedPermissions(permissions).includes('employees'),
  };
}

export async function requireAccessAdministrator(request: NextRequest) {
  const actor = await getAccessManagementActor(request);
  if (!actor.email) {
    return {
      authorized: false as const,
      response: NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 }),
    };
  }
  if (!actor.canManageAccess) {
    return {
      authorized: false as const,
      response: NextResponse.json(
        { success: false, error: 'Administrator access is required to manage application permissions.' },
        { status: 403 }
      ),
    };
  }
  return { authorized: true as const, email: actor.email };
}

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getRequestUserEmail } from '@/lib/requestUser';
import { expandAssignedPermissions, loadUserAssignedPermissionsFromDatabase } from '@/lib/permissions';
import { createPermissionCookieValue, getPermissionCookieOptions, PERMISSION_COOKIE_NAME } from '@/lib/permissionCookie';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildPermissionsETag(email: string, permissions: string[], expandedPermissions: string[]): string {
  const basis = JSON.stringify({
    email: email.toLowerCase(),
    permissions: [...permissions].sort(),
    expandedPermissions: [...expandedPermissions].sort(),
  });
  const hash = createHash('sha1').update(basis).digest('hex');
  return `W/"${hash}"`;
}

function ifNoneMatchContainsETag(ifNoneMatchHeader: string | null, etag: string): boolean {
  if (!ifNoneMatchHeader) return false;
  if (ifNoneMatchHeader.trim() === '*') return true;
  return ifNoneMatchHeader
    .split(',')
    .map(value => value.trim())
    .includes(etag);
}

export async function GET(request: NextRequest) {
  try {
    const email = await getRequestUserEmail(request);
    if (!email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const permissions = await loadUserAssignedPermissionsFromDatabase(prisma, email);
    const expandedPermissions = expandAssignedPermissions(permissions);
    const etag = buildPermissionsETag(email, permissions, expandedPermissions);
    const ifNoneMatch = request.headers.get('if-none-match');

    if (ifNoneMatchContainsETag(ifNoneMatch, etag)) {
      const notModified = new NextResponse(null, { status: 304 });
      notModified.headers.set('ETag', etag);
      notModified.headers.set('Cache-Control', 'private, max-age=60, must-revalidate');
      return notModified;
    }

    const response = NextResponse.json({ success: true, data: { email, permissions, expandedPermissions } });
    response.headers.set('ETag', etag);
    response.headers.set('Cache-Control', 'private, max-age=60, must-revalidate');
    const cookieValue = await createPermissionCookieValue(email, expandedPermissions);

    if (cookieValue) {
      response.cookies.set(PERMISSION_COOKIE_NAME, cookieValue, getPermissionCookieOptions());
    }

    return response;
  } catch (error) {
    console.error('Error fetching current user permissions:', error);
    return NextResponse.json(
      { error: 'Failed to fetch permissions' },
      { status: 500 }
    );
  }
}
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from './prisma';
import { getRequestUserEmail } from './requestUser';
import { hasDatabasePageAccess } from './permissions';

// Lookup access follows the consuming page and is rechecked against current
// assignments. It does not grant access to the full employee/project APIs.
export async function pageLookupResponse(
  request: NextRequest,
  permission: string,
  load: () => Promise<unknown[]>,
) {
  const json = (body: unknown, status = 200) => NextResponse.json(body, {
    status, headers: { 'Cache-Control': 'no-store' },
  });
  try {
    const email = await getRequestUserEmail(request);
    if (!email) return json({ success: false, error: 'Unauthorized' }, 401);
    if (!await hasDatabasePageAccess(prisma, email, permission)) {
      return json({ success: false, error: 'Forbidden' }, 403);
    }
    return json({ success: true, data: await load() });
  } catch {
    return json({ success: false, error: 'Unable to load options. Please try again.' }, 500);
  }
}

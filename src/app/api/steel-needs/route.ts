import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRequestUserEmail } from '@/lib/requestUser';
import { hasDatabasePageAccess } from '@/lib/permissions';
import { loadSteelNeeds } from '@/lib/loadSteelNeeds';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(request: NextRequest) {
  try {
    const actor = await getRequestUserEmail(request);
    if (!actor) return json({ error: 'Sign in to view Steel needs.' }, 401);
    if (!await hasDatabasePageAccess(prisma, actor, 'page:/steel-needs')) return json({ error: 'Steel needs access is required.' }, 403);
    return json(await loadSteelNeeds());
  } catch {
    return json({ error: 'Unable to load Steel needs. Retry or check estimate, WIP and field-entry synchronization.' }, 503);
  }
}

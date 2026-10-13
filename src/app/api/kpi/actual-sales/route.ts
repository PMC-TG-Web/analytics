import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRequestUserEmail } from '@/lib/requestUser';
import { hasDatabasePageAccess } from '@/lib/permissions';
import { loadKpiActualSales } from '@/lib/loadKpiActualSales';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(request: NextRequest) {
  const actor = await getRequestUserEmail(request);
  if (!actor) return json({ error: 'Sign in to view actual sales.' }, 401);
  if (!await hasDatabasePageAccess(prisma, actor, 'kpi')) return json({ error: 'KPI access is required.' }, 403);
  try { return json({ data: await loadKpiActualSales() }); }
  catch { return json({ error: 'Actual sales are unavailable. Please retry.' }, 503); }
}

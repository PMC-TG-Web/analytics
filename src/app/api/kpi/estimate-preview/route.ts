import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getRequestUserEmail } from '@/lib/requestUser';
import { hasDatabasePageAccess } from '@/lib/permissions';
import { loadKpiEstimatePreview } from '@/lib/loadKpiEstimatePreview';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: NextRequest) {
  // Review is local only. No shared-data writes or production preview endpoint.
  if (process.env.NODE_ENV !== 'development') return json({ error: 'Not found.' }, 404);
  const actor = await getRequestUserEmail(request);
  if (!actor) return json({ error: 'Sign in to review estimates.' }, 401);
  if (!await hasDatabasePageAccess(prisma, actor, 'kpi')) return json({ error: 'KPI access is required.' }, 403);
  try { return json({ data: await loadKpiEstimatePreview() }); }
  catch { return json({ error: 'The estimate preview is unavailable. Please retry.' }, 503); }
}

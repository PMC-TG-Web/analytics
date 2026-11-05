import { NextRequest, NextResponse } from 'next/server';
import { getRequestUserEmail } from '@/lib/requestUser';
import { hasDatabasePageAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { completeQboOpenAr, loadQboOpenAr, queueQboOpenAr } from '@/lib/loadQboOpenAr';
import { OpenArDataError } from '@/lib/qboOpenAr';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

async function report(request: NextRequest, refresh: boolean) {
  try {
    const email = await getRequestUserEmail(request);
    if (!email) return json({ error: 'Sign in to view Open A/R.' }, 401);
    if (!await hasDatabasePageAccess(prisma, email, 'accounting-open-ar')) return json({ error: 'Open A/R permission is required.' }, 403);
    const companyId = process.env.PROCORE_COMPANY_ID?.trim();
    if (!companyId || !/^\d+$/.test(companyId)) return json({ error: 'The reporting company is not configured.' }, 503);
    if (refresh) return json({ refresh: await queueQboOpenAr(companyId) }, 202);
    const refreshId = request.nextUrl.searchParams.get('refreshId');
    if (refreshId) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(refreshId)) return json({ error: 'Invalid A/R refresh ID.' }, 400);
      return json(await completeQboOpenAr(companyId, refreshId));
    }
    return json({ report: await loadQboOpenAr(companyId) });
  } catch (error) {
    console.error('[qbo-open-ar] Report failed', { operation: refresh ? 'refresh' : 'read', errorType: error instanceof Error ? error.name : 'UnknownError' });
    return json({ error: error instanceof OpenArDataError ? error.message
      : refresh ? 'Unable to refresh A/R from QBO. Check that the QBO host is online, then retry. The previous saved report was retained.'
        : 'Unable to load the saved A/R report. Please retry.' }, 503);
  }
}
export const GET = (request: NextRequest) => report(request, false);
export const POST = (request: NextRequest) => report(request, true);

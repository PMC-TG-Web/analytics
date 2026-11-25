import { NextRequest, NextResponse } from 'next/server';
import { loadQboOpenArAlertStatus, queueQboOpenAr } from '@/lib/loadQboOpenAr';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

function reportingCompany(request: NextRequest) {
  const secret = (process.env.PROCORE_SYNC_SECRET || process.env.SYNC_SECRET || '').trim();
  if (!secret || request.headers.get('x-sync-secret') !== secret) return json({ error: 'Unauthorized' }, 401);
  const companyId = process.env.PROCORE_COMPANY_ID?.trim();
  if (!companyId || !/^\d+$/.test(companyId)) return json({ error: 'The reporting company is not configured.' }, 503);
  return companyId;
}

export async function GET(request: NextRequest) {
  const companyId = reportingCompany(request);
  if (typeof companyId !== 'string') return companyId;
  try {
    return json(await loadQboOpenArAlertStatus(companyId));
  } catch {
    return json({ error: 'Open A/R refresh status is unavailable.' }, 503);
  }
}

export async function POST(request: NextRequest) {
  const companyId = reportingCompany(request);
  if (typeof companyId !== 'string') return companyId;
  try {
    const refresh = await queueQboOpenAr(companyId, true);
    return json({ refresh }, refresh.state === 'succeeded' ? 200 : 202);
  } catch (error) {
    console.error('[qbo-open-ar-hourly] Queue failed', { errorType: error instanceof Error ? error.name : 'UnknownError' });
    return json({ error: 'Hourly A/R refresh could not be queued. Check the QBO host. The last saved report was retained.' }, 503);
  }
}

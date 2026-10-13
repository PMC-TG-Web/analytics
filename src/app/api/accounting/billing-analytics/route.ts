import { NextRequest, NextResponse } from 'next/server';
import { getRequestUserEmail } from '@/lib/requestUser';
import { canAccessBillingAnalytics } from '@/lib/billingAnalyticsAccess';
import { hasDatabasePageAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { billingMonthRange } from '@/lib/billingAnalytics';
import { loadBillingAnalytics } from '@/lib/loadBillingAnalytics';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: NextRequest) {
  const email = await getRequestUserEmail(request);
  if (!email) return json({ error: 'Sign in to view Billing analytics.' }, 401);
  if (!canAccessBillingAnalytics(email) || !await hasDatabasePageAccess(prisma, email, 'analytics')) return json({ error: 'Forbidden' }, 403);
  const from = request.nextUrl.searchParams.get('from') || '';
  const through = request.nextUrl.searchParams.get('through') || '';
  try { billingMonthRange(from, through); } catch (error) { return json({ error: (error as Error).message }, 400); }
  const companyId = process.env.PROCORE_COMPANY_ID?.trim();
  if (!companyId) return json({ error: 'Billing company is not configured.' }, 503);
  try {
    return json(await loadBillingAnalytics(companyId, from, through));
  } catch {
    return json({ error: 'Unable to load billing hours. Please try again.' }, 500);
  }
}

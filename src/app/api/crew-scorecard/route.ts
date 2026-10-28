import { NextRequest, NextResponse } from 'next/server';
import { isLocalDeveloperRequest } from '@/lib/developerIdentity';
import { getRequestUserEmail } from '@/lib/requestUser';
import { hasDatabasePageAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { crewWeekRange } from '@/lib/crewScorecard';
import { loadCrewScorecard } from '@/lib/loadCrewScorecard';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: NextRequest) {
  if (!isLocalDeveloperRequest(request)) return json({ error: 'This preview is available only on localhost in development.' }, 404);
  try {
    const email = await getRequestUserEmail(request);
    if (!email) return json({ error: 'Sign in to view the Crew Scorecard.' }, 401);
    if (!await hasDatabasePageAccess(prisma, email, 'analytics')) return json({ error: 'Analytics permission is required.' }, 403);
    const week = request.nextUrl.searchParams.get('week') || '';
    try { crewWeekRange(week); } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Choose a valid reporting week.' }, 400);
    }
    const companyId = process.env.PROCORE_COMPANY_ID?.trim();
    if (!companyId) return json({ error: 'The Procore company is not configured.' }, 503);
    return json(await loadCrewScorecard(companyId, week));
  } catch (error) {
    console.error('[crew-scorecard] Read failed', { errorType: error instanceof Error ? error.name : 'UnknownError' });
    return json({ error: 'Unable to load the scorecard. No partial totals are shown. Please retry.' }, 503);
  }
}

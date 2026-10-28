import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getDeveloperEmail, isLocalDeveloperRequest } from '@/lib/developerIdentity';
import { getCurrentUserEmail } from '@/lib/requestUser';
import { hasDatabasePageAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { crewToday, crewWeekStart } from '@/lib/crewScorecard';
import CrewScorecardView from './CrewScorecardView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Crew Scorecard | Local Preview' };

export default async function CrewScorecardPage() {
  const hostname = ((await headers()).get('host') || '').replace(/:\d+$/, '');
  const localRequest = { nextUrl: { hostname }, cookies: await cookies() };
  if (!isLocalDeveloperRequest(localRequest)) notFound();
  const email = getDeveloperEmail(localRequest) || await getCurrentUserEmail();
  if (!email || !await hasDatabasePageAccess(prisma, email, 'analytics')) notFound();
  return <CrewScorecardView initialWeek={crewWeekStart(crewToday())} />;
}

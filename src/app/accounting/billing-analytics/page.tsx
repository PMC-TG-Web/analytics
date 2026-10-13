import { notFound } from 'next/navigation';
import { canAccessBillingAnalytics } from '@/lib/billingAnalyticsAccess';
import { getBillingAnalyticsEmail } from '@/lib/billingAnalyticsSession';
import { hasDatabasePageAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import BillingAnalytics from './BillingAnalytics';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Billing analytics | PMC' };

export default async function BillingAnalyticsPage() {
  const email = await getBillingAnalyticsEmail();
  if (!canAccessBillingAnalytics(email) || !await hasDatabasePageAccess(prisma, email, 'analytics')) notFound();
  const month = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);
  return <BillingAnalytics initialMonth={month} />;
}

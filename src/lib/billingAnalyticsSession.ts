import { cookies, headers } from 'next/headers';
import { getDeveloperEmail } from '@/lib/developerIdentity';
import { getCurrentUserEmail } from '@/lib/requestUser';

export async function getBillingAnalyticsEmail(): Promise<string | null> {
  if (process.env.NODE_ENV === 'development') {
    const host = (await headers()).get('host');
    if (host) {
      let hostname = '';
      try { hostname = new URL(`http://${host}`).hostname; } catch { /* Require the authenticated session below. */ }
      const email = getDeveloperEmail({ nextUrl: { hostname }, cookies: await cookies() });
      if (email) return email;
    }
  }
  return getCurrentUserEmail();
}

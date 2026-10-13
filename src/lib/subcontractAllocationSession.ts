import { cookies, headers } from 'next/headers';
import { getDeveloperEmail } from '@/lib/developerIdentity';
import { getCurrentUserEmail } from '@/lib/requestUser';

/** Match the localhost-only developer identity already used by middleware and APIs. */
export async function getAllocationUserEmail(): Promise<string | null> {
  if (process.env.NODE_ENV === 'development') {
    const host = (await headers()).get('host');
    if (host) {
      let hostname = '';
      try { hostname = new URL(`http://${host}`).hostname; } catch { /* Use the authenticated session below. */ }
      const email = getDeveloperEmail({ nextUrl: { hostname }, cookies: await cookies() });
      if (email) return email;
    }
  }
  return getCurrentUserEmail();
}

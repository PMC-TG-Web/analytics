import { NextRequest } from 'next/server';
import { auth0 } from '@/lib/auth0';

export async function getRequestUserEmail(request: NextRequest): Promise<string | null> {
  const isDev = process.env.NODE_ENV !== 'production';
  const selectedDevEmail = request.cookies.get('dev_user_email')?.value?.trim().toLowerCase();
  const auth0Domain = (process.env.AUTH0_DOMAIN || '').trim().toLowerCase();
  const auth0Misconfigured =
    !auth0Domain ||
    auth0Domain.includes('your-auth0-domain');

  if (isDev && selectedDevEmail) {
    return selectedDevEmail;
  }

  if (isDev && auth0Misconfigured) {
    return 'dev@example.com';
  }

  const session = await auth0.getSession(request);
  return session?.user?.email?.trim().toLowerCase() || null;
}

/**
 * Resolve the current App Router session without re-wrapping its Request.
 *
 * This is important for handlers that have already consumed a POST body. Some
 * serverless runtimes expose NextRequest from a different JavaScript realm;
 * passing that request back to Auth0 can make the SDK rebuild it from an
 * already-consumed stream.
 */
export async function getCurrentUserEmail(): Promise<string | null> {
  const isDev = process.env.NODE_ENV !== 'production';
  const auth0Domain = (process.env.AUTH0_DOMAIN || '').trim().toLowerCase();
  const auth0Misconfigured = !auth0Domain || auth0Domain.includes('your-auth0-domain');

  if (isDev && auth0Misconfigured) return 'dev@example.com';

  const session = await auth0.getSession();
  return session?.user?.email?.trim().toLowerCase() || null;
}

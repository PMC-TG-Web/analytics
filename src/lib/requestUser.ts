import { getDeveloperEmail } from '@/lib/developerIdentity';
import { NextRequest } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { cookies } from 'next/headers';
import { appSessions } from '@/lib/appSession';
import { APP_SESSION_COOKIE, emailSignInEnabled, procoreSignInEnabled } from '@/lib/appSignInPolicy';
import {
  PROCORE_USER_SESSION_COOKIE,
  verifyProcoreUserSessionCookieValue,
} from '@/lib/procoreUserSession';

export async function getRequestUserEmail(request: NextRequest): Promise<string | null> {
  const isDev = process.env.NODE_ENV !== 'production';
  const selectedDevEmail = getDeveloperEmail(request);
  const auth0Domain = (process.env.AUTH0_DOMAIN || '').trim().toLowerCase();
  const auth0Misconfigured =
    !auth0Domain ||
    auth0Domain.includes('your-auth0-domain');

  if (isDev && selectedDevEmail) {
    return selectedDevEmail;
  }

  if (isDev && auth0Misconfigured && !procoreSignInEnabled()) {
    return 'dev@example.com';
  }

  if (procoreSignInEnabled() && request.cookies.has(APP_SESSION_COOKIE)) {
    return (await appSessions.resolve(request.cookies.get(APP_SESSION_COOKIE)?.value))?.user.email || null;
  }
  const session = emailSignInEnabled() ? await auth0.getSession(request) : null;
  const auth0Email = session?.user?.email?.trim().toLowerCase();
  if (auth0Email) return auth0Email;

  if (procoreSignInEnabled()) return null;
  const procoreSession = await verifyProcoreUserSessionCookieValue(
    request.cookies.get(PROCORE_USER_SESSION_COOKIE)?.value,
  );
  return procoreSession?.email || null;
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

  if (isDev && auth0Misconfigured && !procoreSignInEnabled()) return 'dev@example.com';

  if (procoreSignInEnabled()) {
    const store = await cookies();
    if (store.has(APP_SESSION_COOKIE)) return (await appSessions.resolve(store.get(APP_SESSION_COOKIE)?.value))?.user.email || null;
  }

  const session = emailSignInEnabled() ? await auth0.getSession() : null;
  return session?.user?.email?.trim().toLowerCase() || null;
}

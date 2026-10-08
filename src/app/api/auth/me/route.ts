import { getDeveloperEmail } from '@/lib/developerIdentity';
import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';
import { appSessions } from '@/lib/appSession';
import { APP_SESSION_COOKIE, emailSignInEnabled, procoreSignInEnabled } from '@/lib/appSignInPolicy';

export async function GET(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== 'production';
  const selectedDevEmail = getDeveloperEmail(request);
  const auth0Domain = (process.env.AUTH0_DOMAIN || '').trim().toLowerCase();
  const auth0Misconfigured =
    !auth0Domain ||
    auth0Domain.includes('your-auth0-domain');

  // In local dev, honor explicit dev-login cookie first so role testing works reliably.
  if (isDev && selectedDevEmail) {
    const displayName = selectedDevEmail.split('@')[0] || 'Developer';
    return NextResponse.json({
      email: selectedDevEmail,
      name: displayName,
      sub: `dev-${selectedDevEmail}`,
    });
  }

  // In dev mode without Auth0 config, return a mock user
  if (isDev && auth0Misconfigured && !procoreSignInEnabled()) {
    return NextResponse.json({
      email: 'dev@example.com',
      name: 'Developer',
      sub: 'dev-user-id'
    });
  }

  try {
    if (procoreSignInEnabled() && request.cookies.has(APP_SESSION_COOKIE)) {
      const session = await appSessions.resolve(request.cookies.get(APP_SESSION_COOKIE)?.value);
      return NextResponse.json(session ? { ...session.user, provider: 'procore', needsReconnect: session.needsReconnect } : { error: 'Not authenticated' },
        { status: session ? 200 : 401, headers: { 'Cache-Control': 'private, no-store' } });
    }
    const session = emailSignInEnabled() ? await auth0.getSession(request) : null;

    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    return NextResponse.json({
      name: session.user.name,
      email: session.user.email,
      picture: session.user.picture,
      sub: session.user.sub,
    });
  } catch (error) {
    console.error('Failed to get user session:', error);
    return NextResponse.json({ error: 'Failed to get user session' }, { status: 500 });
  }
}

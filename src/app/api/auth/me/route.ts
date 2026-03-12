import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';

export async function GET(request: NextRequest) {
  const isDev = process.env.NODE_ENV !== 'production';
  const auth0Domain = (process.env.AUTH0_DOMAIN || '').trim().toLowerCase();
  const auth0Misconfigured =
    !auth0Domain ||
    auth0Domain.includes('your-auth0-domain');

  // In dev mode without Auth0 config, return a mock user
  if (isDev && auth0Misconfigured) {
    const selectedDevEmail = request.cookies.get('dev_user_email')?.value?.trim();
    if (selectedDevEmail) {
      const displayName = selectedDevEmail.split('@')[0] || 'Developer';
      return NextResponse.json({
        email: selectedDevEmail,
        name: displayName,
        sub: `dev-${selectedDevEmail}`,
      });
    }

    return NextResponse.json({
      email: 'dev@example.com',
      name: 'Developer',
      sub: 'dev-user-id'
    });
  }

  try {
    const session = await auth0.getSession(request);

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

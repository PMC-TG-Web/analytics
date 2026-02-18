import { NextRequest, NextResponse } from 'next/server';

/**
 * Development-only login endpoint
 * Sets a session cookie directly without Auth0 flow
 * 
 * Usage: http://localhost:3000/api/auth/dev-login?email=todd@pmcdecor.com
 */
export async function GET(request: NextRequest) {
  // Only allow in development mode
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'Dev login only available in development' },
      { status: 403 }
    );
  }

  const email = request.nextUrl.searchParams.get('email') || 'todd@pmcdecor.com';
  const returnTo = request.nextUrl.searchParams.get('returnTo') || '/wip';

  // Create a mock user session
  const mockUser = {
    email: email,
    name: email.split('@')[0],
    nickname: email.split('@')[0],
    picture: `https://ui-avatars.com/api/?name=${encodeURIComponent(email)}`,
  };

  // Set auth_session cookie with mock user data
  const response = NextResponse.redirect(new URL(returnTo, request.url));
  
  response.cookies.set('auth_session', JSON.stringify(mockUser), {
    httpOnly: true,
    secure: (process.env.NODE_ENV as string) === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });

  // Also set a mock/real Procore access token from environment if available
  const procoreToken = process.env.PROCORE_ACCESS_TOKEN;
  if (procoreToken) {
    response.cookies.set('procore_access_token', procoreToken, {
      httpOnly: true,
      secure: (process.env.NODE_ENV as string) === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60, // 1 hour
      path: '/',
    });
  }

  return response;
}

import { auth0 } from '@/lib/auth0';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Get current user session.
 * Checks both the official Auth0 SDK session and the fallback manual auth_session cookie.
 */
export async function GET(req: NextRequest) {
  try {
    // 1. Try manual auth_session cookie FIRST (reliable fallback for manual integration)
    const manualSession = req.cookies.get('auth_session');
    if (manualSession?.value) {
      try {
        const user = JSON.parse(manualSession.value);
        if (user && user.email) {
          return NextResponse.json(user);
        }
      } catch (e) {
        console.error('Error parsing manual session cookie:', e);
      }
    }

    // 2. Try fetching session via official SDK (if version 4 is correctly configured)
    try {
      const session = await auth0.getSession();
      if (session && session.user) {
        return NextResponse.json(session.user);
      }
    } catch (sdkError) {
      // Don't let SDK error block the entire request if we're in a strange state
      console.error('Auth0 SDK getSession error:', sdkError);
    }

    // No session found in either location
    return NextResponse.json(
      { error: 'Not authenticated', cookieFound: !!manualSession },
      { status: 401 }
    );
  } catch (error) {
    console.error('Error fetching session:', error);
    return NextResponse.json(
      { error: 'Failed to get session' },
      { status: 500 }
    );
  }
}

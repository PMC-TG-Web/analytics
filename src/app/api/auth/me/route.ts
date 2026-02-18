import { auth0 } from '@/lib/auth0';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Get current user session.
 * Checks both the official Auth0 SDK session and the fallback manual auth_session cookie.
 */
export async function GET(req: NextRequest) {
  try {
    // 1. Try fetching session via official SDK
    const session = await auth0.getSession();
    if (session && session.user) {
      return NextResponse.json(session.user);
    }

    // 2. Fallback: Try manual auth_session cookie (used by existing manual routes)
    const manualSession = req.cookies.get('auth_session');
    if (manualSession?.value) {
      try {
        const user = JSON.parse(manualSession.value);
        return NextResponse.json(user);
      } catch (e) {
        console.error('Error parsing manual session cookie:', e);
      }
    }

    // No session found in either location
    return NextResponse.json(
      { error: 'Not authenticated' },
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

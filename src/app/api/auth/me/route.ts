import { NextRequest, NextResponse } from 'next/server';

/**
 * Get current user session from auth_session cookie
 */
export async function GET(req: NextRequest) {
  try {
    let sessionCookie = req.cookies.get('auth_session');
    
    // If no main auth session, check for procore specific session
    if (!sessionCookie) {
      sessionCookie = req.cookies.get('procore_session');
    }

    if (!sessionCookie?.value) {
      console.log('No auth_session cookie found');
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const user = JSON.parse(sessionCookie.value);
    console.log('Authenticated user:', user.email);

    return NextResponse.json({
      email: user.email,
      name: user.name,
      nickname: user.nickname,
      picture: user.picture,
    });
  } catch (error) {
    console.error('Error parsing session:', error);
    return NextResponse.json(
      { error: 'Failed to get session' },
      { status: 500 }
    );
  }
}

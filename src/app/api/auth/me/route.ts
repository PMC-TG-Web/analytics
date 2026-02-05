import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  // Get the session cookie that Auth0 creates after login
  const authCookie = req.cookies.get('appSession');

  if (!authCookie) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  // For now, return a placeholder user
  // The actual user info is decoded in the Auth0 SDK
  return NextResponse.json({
    email: 'user@example.com',
    name: 'User',
  });
}

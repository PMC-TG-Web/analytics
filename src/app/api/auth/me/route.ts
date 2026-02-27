import { NextRequest, NextResponse } from 'next/server';
import { auth0 } from '@/lib/auth0';

export async function GET(request: NextRequest) {
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

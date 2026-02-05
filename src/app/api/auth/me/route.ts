import { getSession } from '@auth0/nextjs-auth0';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const session = await getSession();

    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    return NextResponse.json({
      email: session.user.email,
      name: session.user.name || session.user.nickname || null,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to get session' }, { status: 500 });
  }
}
